import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createPerformanceNoteInTransaction, getPerformanceNoteForAlliance, updatePerformanceNoteInTransaction } from "@/lib/performance-notes/repository.server";
import type { KnowledgeActor } from "./policy.shared";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, recheckKnowledgeActor, touchKnowledgeResource, type KnowledgeTransaction } from "./resources.server";
import { knowledgeHash, knowledgePrincipalKey, withKnowledgeReceipt } from "./mutations.server";
import { draftStateSchema, reviewedDraftTasks, type CaptureDraft, type CaptureDraftState, type CaptureProvenance } from "./drafts.shared";
import { createNoteTaskInTransaction } from "./tasks.server";
import { noteFieldsSchema, noteTitle } from "./workspace.shared";
import { redactIntakeText } from "./intake.shared";

const drafts = schema.knowledgeCaptureDrafts;
function visibleDraft(actor: KnowledgeActor) {
  return and(eq(drafts.allianceId, actor.allianceId), knowledgeAccessCondition(actor, drafts.resourceId, "share"), sql`exists(select 1 from knowledge_resources where id = ${drafts.resourceId} and archived_at is null)`,  sql`(${drafts.sourceNoteId} is null or exists(select 1 from performance_notes where id = ${drafts.sourceNoteId} and alliance_id = ${actor.allianceId} and expunged_at is null and ${knowledgeAccessCondition(actor, schema.performanceNotes.resourceId, "edit")}))`);
}
function draftDto(row: typeof drafts.$inferSelect, version: number): CaptureDraft {
  return { id: row.id, version, source: row.source, sourceNoteId: row.sourceNoteId, sourceVersion: row.sourceVersion, state: row.state, status: row.status, noteId: row.noteId, updatedAt: row.updatedAt.toISOString() };
}
export async function getCaptureDraft(actor: KnowledgeActor, id: string): Promise<CaptureDraft> {
  const [row] = await getDb().select({ draft: drafts, version: schema.knowledgeResources.version }).from(drafts).innerJoin(schema.knowledgeResources, eq(schema.knowledgeResources.id, drafts.resourceId)).where(and(eq(drafts.id, id), visibleDraft(actor)));
  if (!row) throw new KnowledgeAccessError("not_found");
  return draftDto(row.draft, row.version);
}
export async function listCaptureDrafts(actor: KnowledgeActor) {
  const rows = await getDb().select({ id: drafts.id, source: drafts.source, updatedAt: drafts.updatedAt, state: drafts.state }).from(drafts)
    .where(and(visibleDraft(actor), eq(drafts.status, "open"))).orderBy(desc(drafts.updatedAt)).limit(50);
  return rows.map((row) => ({ id: row.id, source: row.source, title: row.state ? noteTitle(row.state.fields) : "", updatedAt: row.updatedAt.toISOString() }));
}
export async function discardCaptureDraft(actor: KnowledgeActor, id: string) {
  await getDb().transaction(async (tx) => {
    await recheckKnowledgeActor(tx, actor);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`capture-draft:${id}`}, 0))`);
    const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, id), eq(drafts.allianceId, actor.allianceId), knowledgeAccessCondition(actor, drafts.resourceId, "share")));
    if (!draft) return;
    const resource = await lockKnowledgeResource(tx, actor, draft.resourceId, "share");
    if (draft.status !== "open") return;
    await tx.update(schema.knowledgeResources).set({ archivedAt: new Date() }).where(eq(schema.knowledgeResources.id, resource.id));
    await touchKnowledgeResource(tx, resource.id);
  });
}

async function assertDraftSource(tx: KnowledgeTransaction, actor: KnowledgeActor, sourceNoteId: string | null) {
  if (!sourceNoteId) return;
  const [source] = await tx.select({ id: schema.performanceNotes.id }).from(schema.performanceNotes).where(and(eq(schema.performanceNotes.id, sourceNoteId), eq(schema.performanceNotes.allianceId, actor.allianceId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(actor, schema.performanceNotes.resourceId, "edit")));
  if (!source) throw new KnowledgeAccessError("not_found");
}

export async function saveCaptureDraft(actor: KnowledgeActor & { canCreate?: boolean }, id: string, input: { expectedVersion: number; state: CaptureDraftState; sourceNoteId: string | null; sourceVersion: number | null }): Promise<CaptureDraft> {
  const state = draftStateSchema.parse(input.state);
  const stateHash = knowledgeHash(state);
  await getDb().transaction(async (tx) => {
    await recheckKnowledgeActor(tx, actor);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`capture-draft:${id}`}, 0))`);
    const [existing] = await tx.select().from(drafts).where(eq(drafts.id, id));
    if (!existing) {
      if (input.expectedVersion !== 0 || !input.sourceNoteId && actor.kind === "web" && !actor.canCreate) throw new KnowledgeAccessError("forbidden");
      await assertDraftSource(tx, actor, input.sourceNoteId);
      if (!!input.sourceNoteId !== !!input.sourceVersion) throw new KnowledgeAccessError("invalid");
      const resourceId = await createKnowledgeResource(tx, actor, "draft", id);
      await tx.insert(drafts).values({ id, allianceId: actor.allianceId, resourceId, source: actor.kind, sourceNoteId: input.sourceNoteId, sourceVersion: input.sourceVersion, state, stateHash });
      return;
    }
    const resource = await lockKnowledgeResource(tx, actor, existing.resourceId, "share");
    await assertDraftSource(tx, actor, existing.sourceNoteId);
    if (resource.archivedAt || existing.status !== "open" && existing.stateHash !== stateHash) throw new KnowledgeAccessError("changed");
    if (existing.sourceNoteId !== input.sourceNoteId || existing.sourceVersion !== input.sourceVersion) throw new KnowledgeAccessError("invalid");
    if (existing.stateHash === stateHash) return;
    if (resource.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    await tx.update(drafts).set({ state, stateHash, updatedAt: new Date() }).where(eq(drafts.id, id));
    await touchKnowledgeResource(tx, resource.id);
  });
  return getCaptureDraft(actor, id);
}

async function provenance(tx: KnowledgeTransaction, actor: KnowledgeActor, draft: typeof drafts.$inferSelect, version: number, state: CaptureDraftState, actionKey?: string): Promise<CaptureProvenance> {
  const action = state.tasks.find((task) => task.actionKey === actionKey);
  const analysisId = action?.analysisId ?? state.analysisId;
  const [owner] = await tx.select({ discordUserId: schema.knowledgeResources.ownerDiscordUserId }).from(schema.knowledgeResources).where(eq(schema.knowledgeResources.id, draft.resourceId));
  const principals = [knowledgePrincipalKey(actor), ...(owner?.discordUserId ? [`discord:${owner.discordUserId}`] : [])];
  const [analysis] = analysisId ? await tx.select().from(schema.knowledgeIntakeAnalyses).where(and(eq(schema.knowledgeIntakeAnalyses.id, analysisId), eq(schema.knowledgeIntakeAnalyses.allianceId, actor.allianceId), inArray(schema.knowledgeIntakeAnalyses.principalKey, principals), eq(schema.knowledgeIntakeAnalyses.state, "complete"))) : [];
  const inputHash = knowledgeHash(state.fields.body.trim());
  const result = analysis?.result;
  const valid = !!result && result.draftId === draft.id && result.bodyHash === inputHash && result.revision === state.revision;
  const proposed = actionKey ? result?.actions.find((item) => item.actionKey === actionKey) : null;
  const modes: Record<string, "auto" | "manual"> = action ? { ...action.modes } : { priority: state.fields.priorityMode };
  for (const key of Object.keys(modes)) {
    const matches = action ? proposed && proposed[key as keyof typeof proposed] === action[key as keyof typeof action] : result?.priority === state.fields.priority;
    if (!valid || !matches) modes[key] = "manual";
  }
  return { draftId: draft.id, draftVersion: version, inputHash, analysisId: valid ? analysisId : null, interpreter: valid ? result.interpreter ?? null : null, evidence: valid ? proposed?.evidence ?? result.priorityEvidence : null, modes };
}

export async function commitCaptureDraft(actor: KnowledgeActor & { canCreate?: boolean }, id: string, expectedVersion: number, requestId: string) {
  const [completed] = await getDb().select({ noteId: drafts.noteId, taskIds: drafts.taskIds }).from(drafts).where(and(eq(drafts.id, id), visibleDraft(actor), eq(drafts.status, "committed")));
  if (completed?.noteId) return { noteId: completed.noteId, taskIds: completed.taskIds };
  return withKnowledgeReceipt(actor, "notes.capture", requestId, { id, expectedVersion }, async (tx, receiptId) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`capture-draft:${id}`}, 0))`);
    const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, id), visibleDraft(actor)));
    if (!draft) throw new KnowledgeAccessError("not_found");
    const resource = await lockKnowledgeResource(tx, actor, draft.resourceId, "share");
    if (draft.status === "committed" && draft.noteId) return { noteId: draft.noteId, taskIds: draft.taskIds };
    if (resource.version !== expectedVersion || !draft.state) throw new KnowledgeAccessError("changed");
    const state = draftStateSchema.parse(draft.state);
    const fields = noteFieldsSchema.parse(state.fields);
    const selected = reviewedDraftTasks(state);
    if ((!draft.sourceNoteId || selected.length) && actor.kind === "web" && !actor.canCreate) throw new KnowledgeAccessError("forbidden");
    if (new Set(selected.map((task) => task.actionKey)).size !== selected.length) throw new KnowledgeAccessError("invalid");
    let noteId = draft.sourceNoteId;
    let ownsNote = !noteId;
    if (noteId) {
      const source = await getPerformanceNoteForAlliance({ actor, noteId, access: "edit" });
      if (!source || !draft.sourceVersion) throw new KnowledgeAccessError("not_found");
      ownsNote = source.isOwner;
      const { notebook, inbox, excludedMemberIds, ...sharedFields } = fields;
      await updatePerformanceNoteInTransaction(tx, actor, noteId, { ...sharedFields, documentType: state.fields.documentType, keyDecisions: state.fields.keyDecisions, openQuestions: state.fields.openQuestions, ...(source.isOwner ? { notebook, inbox, excludedMemberIds, ...(state.archive !== null ? { archived: state.archive } : {}) } : {}), expectedVersion: draft.sourceVersion });
    } else noteId = await createPerformanceNoteInTransaction(tx, { ...fields, actor, captureSource: draft.source, captureDiscordUserId: resource.ownerDiscordUserId, intakeMode: fields.kind === "note" ? "thought" : "batch" });
    if (ownsNote) await tx.update(schema.performanceNotes).set({ intakeProvenance: await provenance(tx, actor, draft, resource.version, state) }).where(eq(schema.performanceNotes.id, noteId));
    const taskIds: string[] = [];
    for (const task of selected) {
      const trace = await provenance(tx, actor, draft, resource.version, state, task.actionKey);
      if (trace.evidence && !redactIntakeText(fields.body).includes(trace.evidence)) throw new KnowledgeAccessError("invalid");
      const taskId = await createNoteTaskInTransaction(tx, actor, { ...task, sourceNoteId: noteId, assigneeHqUserId: null, shareWithAssignee: false }, { key: receiptId, actionKey: task.actionKey });
      await tx.update(schema.officerActionItems).set({ intakeProvenance: trace }).where(eq(schema.officerActionItems.id, taskId));
      taskIds.push(taskId);
    }
    await tx.update(drafts).set({ status: "committed", state: null, noteId, taskIds, updatedAt: new Date() }).where(eq(drafts.id, id));
    await touchKnowledgeResource(tx, resource.id);
    return { noteId, taskIds };
  });
}
