import "server-only";

import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { getKnowledgeActorForGenerationJob, type KnowledgeWebActor } from "./access.server";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, type KnowledgeTransaction } from "./resources.server";
import { knowledgeMemberMayProcess, recheckKnowledgeReader } from "./knowledge-access.server";
import { collectGenerationEvidence, retrieveKnowledgeEvidence, revalidateKnowledgeEvidence } from "@/lib/officer-intel/retrieve-corpus.server";
import { GENERATION_SYSTEM, generateKnowledgePart, generationConfigured, generationModel } from "@/lib/officer-intel/synthesize.server";
import { generationAcceptSchema, generationBody, generationCandidateAvailable, generationRequestSchema, type GenerationResult } from "./generation.shared";
import type { KnowledgeEvidence } from "./knowledge.shared";
import { reserveKnowledgeUsage } from "./knowledge-budget.server";
import { withKnowledgeReceipt } from "./mutations.server";
import { redactIntakeText } from "./intake.shared";
import { createPerformanceNoteInTransaction, getPerformanceNoteForAlliance, getPerformanceNoteDto } from "@/lib/performance-notes/repository.server";
import { createNoteTaskInTransaction } from "./tasks.server";
import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import { resourcePaging, resourcePage, timePageBoundary } from "./pagination.server";
import { KNOWLEDGE_PAGE_SIZE } from "./pagination.shared";

const jobs = schema.knowledgeGenerationJobs, resources = schema.knowledgeResources, threads = schema.officerIntelThreads;
type Job = typeof jobs.$inferSelect;
async function ownedJob(actor: KnowledgeWebActor, id: string) {
  const [job] = await getDb().select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.allianceId, actor.allianceId), knowledgeAccessCondition(actor, jobs.resourceId, "share")));
  if (!job) throw new KnowledgeAccessError("not_found");
  return job;
}
async function lockInputs(tx: KnowledgeTransaction, actor: KnowledgeWebActor, evidence: KnowledgeEvidence[]) {
  await recheckKnowledgeReader(tx, actor);
  const ids = [...new Set(evidence.map((item) => item.resourceId))].sort();
  if (!ids.length || evidence.length > 120) throw new KnowledgeAccessError("changed");
  const owners = await tx.select({ owner: resources.ownerHqUserId }).from(resources).where(inArray(resources.id, ids));
  for (const owner of [...new Set(owners.map((row) => row.owner))].sort()) if (!owner || !await knowledgeMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: owner })) throw new KnowledgeAccessError("changed");
  await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.allianceId, actor.allianceId), inArray(resources.id, ids))).orderBy(resources.id).for("update");
  if (!await revalidateKnowledgeEvidence(actor, evidence, 120)) throw new KnowledgeAccessError("changed");
}
export async function getGeneration(actor: KnowledgeWebActor, id: string): Promise<GenerationResult> {
  const job = await ownedJob(actor, id);
  const valid = await revalidateKnowledgeEvidence(actor, job.evidence, 120);
  const note = job.noteId ? await getPerformanceNoteForAlliance({ actor, noteId: job.noteId }) : null;
  return { review: valid && job.state === "ready" ? job.review : null, id, kind: job.kind, state: valid ? job.state : "invalidated", version: job.version, cursor: job.cursor, total: job.inputIds.length, locale: job.locale, errorCode: job.errorCode, parts: valid && ["ready", "accepted"].includes(job.state) ? job.parts : [], evidence: valid && ["ready", "accepted"].includes(job.state) ? job.evidence : [], noteId: note?.id ?? null, threadId: job.threadId };
}
export async function listGenerationPage(actor: KnowledgeWebActor, cursor: string | null = null) {
  const page = resourcePaging(actor, ["generations"], cursor);
  const rows = await getDb().select({ id: jobs.id, kind: jobs.kind, state: jobs.state, createdAt: jobs.createdAt,
    cursorTime: sql<string>`to_char(${jobs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }).from(jobs)
    .where(and(eq(jobs.allianceId, actor.allianceId), knowledgeAccessCondition(actor, jobs.resourceId, "share"), timePageBoundary(page, jobs.createdAt, jobs.id)))
    .orderBy(page.order(jobs.createdAt), page.order(jobs.id)).limit(KNOWLEDGE_PAGE_SIZE + 1);
  const result = resourcePage(rows, page, (row) => ({ id: row.id, position: row.cursorTime }));
  return { ...result, items: result.items.map((row) => ({ id: row.id, kind: row.kind, state: row.state, createdAt: row.createdAt })) };
}
export const listGenerations = async (actor: KnowledgeWebActor) => (await listGenerationPage(actor)).items;
export async function startGeneration(actor: KnowledgeWebActor, input: z.infer<typeof generationRequestSchema>) {
  if (!generationConfigured()) throw new KnowledgeAccessError("not_configured");
  if (input.kind !== "ask" && !actor.canCreate) throw new KnowledgeAccessError("forbidden");
  if (input.kind === "ask" && !input.question.trim()) throw new KnowledgeAccessError("invalid");
  let evidence = input.kind === "ask" ? await retrieveKnowledgeEvidence(actor, { q: input.question, mode: "semantic", includeSources: input.includeSources, limit: 4 }) : await collectGenerationEvidence(actor, input.resourceIds);
  if (!evidence.length) throw new KnowledgeAccessError("invalid_analysis");
  const inputIds = evidence.map((item) => item.id);
  const context: Array<{ question: string; answer: string }> = [];
  let expectedThreadVersion: number | null = null;
  if (input.threadId) {
    if (input.kind !== "ask") throw new KnowledgeAccessError("invalid");
    const [thread] = await getDb().select().from(threads).where(and(eq(threads.id, input.threadId), eq(threads.allianceId, actor.allianceId), eq(threads.createdByHqUserId, actor.hqUserId!), eq(threads.knowledgeVersion, 1)));
    if (!thread) throw new KnowledgeAccessError("not_found");
    expectedThreadVersion = thread.version;
    const previous = await getDb().select().from(jobs).where(and(eq(jobs.threadId, thread.id), inArray(jobs.state, ["ready", "accepted"]))).orderBy(desc(jobs.createdAt)).limit(2);
    for (const turn of previous.reverse()) {
      if (!await revalidateKnowledgeEvidence(actor, turn.evidence, 120)) throw new KnowledgeAccessError("changed");
      const answer = generationBody(turn.parts);
      if (answer.length + turn.question.length + JSON.stringify(context).length <= 3_000) {
        context.push({ question: turn.question, answer });
        evidence = [...new Map([...evidence, ...turn.evidence].map((item) => [item.id, item])).values()];
      }
    }
  }
  return withKnowledgeReceipt(actor, input.kind === "ask" ? "notes.generation_ask" : "notes.generation_start", input.requestId, input, async (tx) => {
    if (input.kind !== "ask" && !await knowledgeMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId! })) throw new KnowledgeAccessError("forbidden");
    await lockInputs(tx, actor, evidence);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`generation-quota:${actor.hqUserId}`}, 0))`);
    const [quota] = await tx.select({ active: sql<number>`count(*) filter(where state in ('pending','running'))`, recent: sql<number>`count(*) filter(where created_at > now() - interval '1 day')` }).from(jobs).where(eq(jobs.requesterId, actor.hqUserId!));
    if (Number(quota.active) >= 3 || Number(quota.recent) >= 30) throw new KnowledgeAccessError("rate_limited");
    const id = nanoid(), resourceId = await createKnowledgeResource(tx, actor, "draft", id);
    let threadId = input.threadId, threadVersion: number | null = null;
    if (input.kind === "ask") {
      if (!threadId) { threadId = nanoid(); await tx.insert(threads).values({ id: threadId, allianceId: actor.allianceId, createdByHqUserId: actor.hqUserId, knowledgeVersion: 1 }); }
      const [thread] = await tx.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.allianceId, actor.allianceId), eq(threads.createdByHqUserId, actor.hqUserId!), eq(threads.knowledgeVersion, 1))).for("update");
      if (!thread || thread.activeJobId || expectedThreadVersion !== null && thread.version !== expectedThreadVersion) throw new KnowledgeAccessError("changed");
      threadVersion = thread.version + 1;
      await tx.update(threads).set({ activeJobId: id, version: threadVersion }).where(eq(threads.id, threadId));
    }
    await tx.insert(jobs).values({ id, resourceId, allianceId: actor.allianceId, requesterId: actor.hqUserId!, sessionId: actor.sessionId, kind: input.kind, locale: input.locale, model: generationModel(), question: redactIntakeText(input.question), evidence, inputIds, context, threadId, threadVersion });
    return { jobId: id, resourceId };
  });
}
async function releaseThread(tx: KnowledgeTransaction, job: Pick<Job, "id" | "threadId">) {
  if (job.threadId) await tx.update(threads).set({ activeJobId: null, version: sql`${threads.version} + 1` }).where(and(eq(threads.id, job.threadId), eq(threads.activeJobId, job.id)));
}
export async function controlGeneration(actor: KnowledgeWebActor, id: string, command: "cancel" | "retry", expectedVersion: number) {
  const existing = await ownedJob(actor, id);
  await getDb().transaction(async (tx) => {
    if (command === "retry") await lockInputs(tx, actor, existing.evidence); else await recheckKnowledgeReader(tx, actor);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, id), knowledgeAccessCondition(actor, jobs.resourceId, "share"))).for("update");
    if (!job) throw new KnowledgeAccessError("not_found");
    if (job.version !== expectedVersion || job.state === "accepted") throw new KnowledgeAccessError("changed");
    if (command === "retry" && (!['failed','cancelled'].includes(job.state) || job.threadId || job.model !== generationModel())) throw new KnowledgeAccessError("changed");
    await tx.update(jobs).set({ state: command === "cancel" ? "cancelled" : "pending", attempts: 0, errorCode: null, leaseToken: null, leaseExpiresAt: null, availableAt: new Date(), sessionId: actor.sessionId, requesterId: actor.hqUserId!, version: job.version + 1 }).where(eq(jobs.id, id));
    if (command === "cancel") await releaseThread(tx, job);
  });
  await writeOfficerActionAudit({ sessionId: actor.sessionId, hqUserId: actor.hqUserId, allianceId: actor.allianceId, action: `notes.generation_${command}`, severity: "update", permission: "notes:read", resourceType: "generation", resourceId: id });
}
export async function stopGeneration(id: string, token: string, error: unknown) {
  await getDb().transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.leaseToken, token), eq(jobs.state, "running"))).for("update");
    if (!job || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) return;
    const changed = error instanceof KnowledgeAccessError && ["changed", "forbidden", "not_found"].includes(error.code);
    const state = changed ? "cancelled" : job.attempts >= 3 ? "failed" : "pending";
    await tx.update(jobs).set({ state, leaseToken: null, leaseExpiresAt: null, errorCode: changed ? "changed" : "processing_failed", availableAt: new Date(Date.now() + 5_000), version: job.version + 1 }).where(eq(jobs.id, id));
    if (state !== "pending") await releaseThread(tx, job);
  });
}
export async function cancelGenerationCandidate(candidate: Pick<Job, "id" | "version" | "threadId">) {
  await getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(jobs).where(eq(jobs.id, candidate.id)).for("update");
    if (!current || !generationCandidateAvailable(current, candidate.version)) return;
    await tx.update(jobs).set({ state: "cancelled", errorCode: "changed", leaseToken: null, leaseExpiresAt: null, version: current.version + 1 }).where(eq(jobs.id, current.id));
    await releaseThread(tx, current);
  });
}
export async function processGeneration(id?: string) {
  if (!generationConfigured()) return { processed: false };
  const candidates = await getDb().select().from(jobs).where(and(id ? eq(jobs.id, id) : undefined, lte(jobs.availableAt, new Date()), or(eq(jobs.state, "pending"), and(eq(jobs.state, "running"), lte(jobs.leaseExpiresAt, new Date()))))).orderBy(asc(jobs.availableAt)).limit(5);
  for (const candidate of candidates) {
    const actor = await getKnowledgeActorForGenerationJob(candidate.id);
    if (!actor) { await cancelGenerationCandidate(candidate); continue; }
    let lease: Job | null = null;
    try {
      lease = await getDb().transaction(async (tx) => {
        if (candidate.kind !== "ask" && !await knowledgeMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId! })) throw new KnowledgeAccessError("forbidden");
        await lockInputs(tx, actor, candidate.evidence);
        const [job] = await tx.select().from(jobs).where(eq(jobs.id, candidate.id)).for("update");
        if (!generationCandidateAvailable(job, candidate.version)) return null;
        if (job.attempts >= 3 || job.model !== generationModel()) { await tx.update(jobs).set({ state: "failed", errorCode: "attempt_limit", leaseToken: null }).where(eq(jobs.id, job.id)); await releaseThread(tx, job); return null; }
        const [claimed] = await tx.update(jobs).set({ state: "running", leaseToken: nanoid(), leaseExpiresAt: new Date(Date.now() + 90_000), attempts: job.attempts + 1, version: job.version + 1 }).where(eq(jobs.id, job.id)).returning();
        return claimed;
      });
      if (!lease) continue;
      const batchSize = lease.kind === "localize" ? 2 : 4;
      const selected = lease.inputIds.slice(lease.cursor, lease.cursor + batchSize).map((key) => lease!.evidence.find((source) => source.id === key)!);
      const input = { kind: lease.kind, locale: lease.locale, question: lease.question, context: lease.context, sources: selected.map((source) => ({ id: source.id, text: source.text })) };
      await getDb().transaction(async (tx) => {
        await lockInputs(tx, actor, lease!.evidence);
        const [current] = await tx.select().from(jobs).where(and(eq(jobs.id, lease!.id), knowledgeAccessCondition(actor, jobs.resourceId, "share"))).for("update");
        if (!current || current.state !== "running" || current.leaseToken !== lease!.leaseToken || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date() || current.model !== generationModel()) throw new KnowledgeAccessError("changed");
        await reserveKnowledgeUsage(tx, actor.allianceId, `hq:${actor.hqUserId}`, "generate", JSON.stringify(input).length + GENERATION_SYSTEM.length);
      });
      const part = await generateKnowledgePart(input);
      const saved = await getDb().transaction(async (tx) => {
        if (lease!.kind !== "ask" && !await knowledgeMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId! })) throw new KnowledgeAccessError("forbidden");
        await lockInputs(tx, actor, lease!.evidence);
        const [current] = await tx.select().from(jobs).where(and(eq(jobs.id, lease!.id), knowledgeAccessCondition(actor, jobs.resourceId, "share"))).for("update");
        if (!current || current.state !== "running" || current.leaseToken !== lease!.leaseToken || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date() || current.model !== generationModel()) return false;
        const parts = [...current.parts, part], cursor = current.cursor + selected.length;
        if (generationBody(parts).length > 100_000) throw new KnowledgeAccessError("invalid_analysis");
        const done = cursor === current.inputIds.length;
        await tx.update(jobs).set({ parts, cursor, state: done ? "ready" : "pending", attempts: 0, version: current.version + 1, leaseToken: null, leaseExpiresAt: null, availableAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, current.id));
        if (done && current.threadId) {
          const [thread] = await tx.select().from(threads).where(eq(threads.id, current.threadId)).for("update");
          if (!thread || thread.activeJobId !== current.id || thread.version !== current.threadVersion) throw new KnowledgeAccessError("changed");
          await tx.insert(schema.officerIntelThreadMessages).values([{ id: nanoid(), allianceId: current.allianceId, threadId: current.threadId, role: "user", content: current.question, citationsJson: { generationId: current.id } }, { id: nanoid(), allianceId: current.allianceId, threadId: current.threadId, role: "assistant", content: generationBody(parts), citationsJson: { generationId: current.id } }]);
          await tx.update(threads).set({ activeJobId: null, version: thread.version + 1, turnCount: thread.turnCount + 1, updatedAt: new Date() }).where(eq(threads.id, thread.id));
        }
        return true;
      });
      if (saved) await writeOfficerActionAudit({ sessionId: actor.sessionId, allianceId: actor.allianceId, hqUserId: actor.hqUserId, action: "notes.generation_step", permission: candidate.kind === "ask" ? "notes:read" : "notes:create", severity: "routine", resourceType: "generation", resourceId: candidate.id, metadata: { cursor: lease.cursor, count: selected.length } });
      return { processed: saved };
    } catch (error) {
      if (lease?.leaseToken) await stopGeneration(lease.id, lease.leaseToken, error);
      else await cancelGenerationCandidate(candidate);
      return { processed: false };
    }
  }
  return { processed: false };
}
export async function saveGenerationReview(actor: KnowledgeWebActor, id: string, input: z.infer<typeof generationAcceptSchema>) {
  const existing = await ownedJob(actor, id);
  return withKnowledgeReceipt(actor, "notes.generation_review", input.requestId, { id, ...input }, async (tx) => {
    await lockInputs(tx, actor, existing.evidence);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, id), knowledgeAccessCondition(actor, jobs.resourceId, "share"))).for("update");
    if (!job || job.state !== "ready" || job.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    await tx.update(jobs).set({ review: { title: redactIntakeText(input.title), body: redactIntakeText(input.body), actions: input.actions.map((action) => ({ ...action, title: redactIntakeText(action.title), description: action.description ? redactIntakeText(action.description) : null, evidence: action.evidence ? redactIntakeText(action.evidence) : null, labels: action.labels.map(redactIntakeText) })) }, version: job.version + 1 }).where(eq(jobs.id, id));
    return { jobId: id };
  });
}
export async function acceptGeneration(actor: KnowledgeWebActor, id: string, input: z.infer<typeof generationAcceptSchema>) {
  const existing = await ownedJob(actor, id);
  if (existing.state === "accepted" && existing.noteId) return { noteId: existing.noteId };
  return withKnowledgeReceipt(actor, "notes.generation_accept", input.requestId, { id, ...input }, async (tx, receiptId) => {
    if (!actor.canCreate || !await knowledgeMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId! })) throw new KnowledgeAccessError("forbidden");
    await lockInputs(tx, actor, existing.evidence);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, id), knowledgeAccessCondition(actor, jobs.resourceId, "share"))).for("update");
    if (!job) throw new KnowledgeAccessError("not_found");
    if (job.state === "accepted" && job.noteId) return { noteId: job.noteId };
    if (job.state !== "ready" || job.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    const proposals: Map<string, { evidence: string }> = new Map(job.parts.flatMap((part, p) => part.actions.map((action, a) => [`${p}:${a}`, action] as const)));
    const selected = input.actions.filter((action) => action.included);
    if (new Set(selected.map((action) => action.actionKey)).size !== selected.length || selected.some((action) => action.evidence !== proposals.get(action.actionKey)?.evidence)) throw new KnowledgeAccessError("invalid");
    const noteId = await createPerformanceNoteInTransaction(tx, { actor, kind: "note", intakeMode: "thought", title: redactIntakeText(input.title), body: redactIntakeText(input.body), documentType: job.kind === "synthesize" ? "meeting" : "reference" });
    const taskIds = [];
    for (const action of selected) taskIds.push(await createNoteTaskInTransaction(tx, actor, { ...action, title: redactIntakeText(action.title), description: action.description ? redactIntakeText(action.description) : null, sourceNoteId: noteId, assigneeHqUserId: null, shareWithAssignee: false }, { key: receiptId, actionKey: action.actionKey }));
    await tx.insert(schema.knowledgeGeneratedDocuments).values({ noteId, allianceId: actor.allianceId, jobId: job.id, kind: job.kind, locale: job.locale, evidence: job.evidence });
    await tx.update(jobs).set({ state: "accepted", noteId, review: null, version: job.version + 1 }).where(eq(jobs.id, job.id));
    return { noteId, taskIds };
  });
}
export async function listGeneratedInsights(actor: KnowledgeWebActor) {
  const rows = await getDb().select({ id: schema.performanceNotes.id }).from(schema.knowledgeGeneratedDocuments).innerJoin(schema.performanceNotes, eq(schema.performanceNotes.id, schema.knowledgeGeneratedDocuments.noteId)).where(and(eq(schema.knowledgeGeneratedDocuments.allianceId, actor.allianceId), eq(schema.knowledgeGeneratedDocuments.kind, "insight"), knowledgeAccessCondition(actor, schema.performanceNotes.resourceId))).orderBy(desc(schema.performanceNotes.updatedAt)).limit(50);
  return (await Promise.all(rows.map((row) => getPerformanceNoteDto({ actor, noteId: row.id })))).filter((row) => row !== null);
}
export async function generatedNoteEvidence(actor: KnowledgeWebActor, noteId: string) {
  if (!await getPerformanceNoteForAlliance({ actor, noteId })) throw new KnowledgeAccessError("not_found");
  const [document] = await getDb().select().from(schema.knowledgeGeneratedDocuments).where(and(eq(schema.knowledgeGeneratedDocuments.noteId, noteId), eq(schema.knowledgeGeneratedDocuments.allianceId, actor.allianceId)));
  if (!document) return { origin: null, evidence: [] as KnowledgeEvidence[] };
  const evidence: KnowledgeEvidence[] = [];
  for (const id of new Set(document.evidence.map((item) => item.resourceId))) {
    const group = document.evidence.filter((item) => item.resourceId === id);
    if (await revalidateKnowledgeEvidence(actor, group, 120)) evidence.push(...group);
  }
  return { origin: "generation" as const, evidence };
}
export async function getGenerationThread(actor: KnowledgeWebActor, id: string) {
  const [thread] = await getDb().select().from(threads).where(and(eq(threads.id, id), eq(threads.allianceId, actor.allianceId), eq(threads.createdByHqUserId, actor.hqUserId!), eq(threads.knowledgeVersion, 1)));
  if (!thread) throw new KnowledgeAccessError("not_found");
  const turns = await getDb().select({ id: jobs.id }).from(jobs).where(eq(jobs.threadId, id)).orderBy(desc(jobs.createdAt)).limit(10);
  return { id, version: thread.version, turns: await Promise.all(turns.reverse().map((turn) => getGeneration(actor, turn.id))) };
}
