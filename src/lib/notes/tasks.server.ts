import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { createPerformanceNoteInTransaction, getPerformanceNoteForAlliance } from "@/lib/performance-notes/repository.server";
import type { CaptureCommit } from "./intake.shared";
import { redactIntakeText } from "./intake.shared";
import { knowledgeActorOwnsResource, type KnowledgeActor, type KnowledgeAccess } from "./policy.shared";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, touchKnowledgeResource, type KnowledgeTransaction } from "./resources.server";
import { withKnowledgeReceipt } from "./mutations.server";
import { lockTaskBoards, touchTaskBoards } from "./board-events.server";
import { noteTitle } from "./workspace.shared";
import { normalizeTaskPriority, taskCompletedAt, TASK_STATUSES, type NoteTask, type TaskCreate, type TaskPatch, type TaskStatus } from "./tasks.shared";

const tasks = schema.officerActionItems;
const resources = schema.knowledgeResources;

async function taskRows(actor: KnowledgeActor, filter?: { id?: string; sourceNoteId?: string; boardId?: string; personalOnly?: boolean }, access: KnowledgeAccess = "read", db: Pick<KnowledgeTransaction, "select"> = getDb()): Promise<NoteTask[]> {
  if (filter?.sourceNoteId && !await getPerformanceNoteForAlliance({ actor, noteId: filter.sourceNoteId })) throw new KnowledgeAccessError("not_found");
  const rows = await db.select({
    task: tasks, version: resources.version, archivedAt: resources.archivedAt,
    owner: knowledgeAccessCondition(actor, tasks.resourceId, "share"), edit: knowledgeAccessCondition(actor, tasks.resourceId, "edit"),
    shared: sql<boolean>`exists(select 1 from knowledge_resource_grants g where g.resource_id = ${tasks.resourceId} and g.alliance_id = ${actor.allianceId})`,
    assigneeId: schema.hqUsers.id, assigneeName: schema.hqUsers.displayName,
    sourceId: schema.performanceNotes.id, sourceTitle: schema.performanceNotes.title,
    sourceBody: schema.performanceNotes.body, sourceChannel: schema.performanceNotes.source,
  }).from(tasks).innerJoin(resources, and(eq(resources.id, tasks.resourceId), eq(resources.allianceId, tasks.allianceId), eq(resources.kind, "task"), eq(resources.entityId, tasks.id)))
    .leftJoin(schema.hqUsers, eq(schema.hqUsers.id, tasks.assigneeHqUserId))
    .leftJoin(schema.performanceNotes, and(eq(schema.performanceNotes.id, tasks.sourceNoteId), eq(schema.performanceNotes.allianceId, actor.allianceId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(actor, schema.performanceNotes.resourceId)))
    .where(and(
      eq(tasks.allianceId, actor.allianceId),
      knowledgeAccessCondition(actor, tasks.resourceId, access),
      filter?.id ? eq(tasks.id, filter.id) : undefined,
      filter?.sourceNoteId ? eq(tasks.sourceNoteId, filter.sourceNoteId) : undefined,
      filter?.boardId ? sql`exists(select 1 from knowledge_board_items bi where bi.task_id = ${tasks.id} and bi.alliance_id = ${actor.allianceId} and bi.board_id = ${filter.boardId})` : undefined,
      filter?.personalOnly ? sql`(${resources.ownerHqUserId} = ${actor.hqUserId} or ${tasks.assigneeHqUserId} = ${actor.hqUserId})` : undefined,
    ))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id)).limit(filter?.id ? 1 : filter?.boardId ? 200 : 100);
  return rows.filter((row) => (TASK_STATUSES as readonly string[]).includes(row.task.status)).map((row) => ({
    id: row.task.id, title: row.task.title, description: row.task.description, status: row.task.status as TaskStatus,
    priority: normalizeTaskPriority(row.task.priority), labels: row.task.labels,
    intakeProvenance: row.owner && row.sourceId ? row.task.intakeProvenance : undefined,
    dueAt: row.task.dueAt?.toISOString() ?? null, completedAt: row.task.completedAt?.toISOString() ?? null,
    assignee: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName?.includes("@") ? null : row.assigneeName } : null,
    legacyAssigneeName: row.task.assigneeNameRaw,
    source: row.sourceId && (row.sourceChannel === "web" || row.sourceChannel === "discord") ? { id: row.sourceId, title: noteTitle({ title: row.sourceTitle ?? "", body: row.sourceBody ?? "" }), channel: row.sourceChannel } : null,
    version: row.version, isOwner: row.owner === true, canEdit: row.edit === true, shared: row.shared === true, archived: row.archivedAt !== null,
    createdAt: row.task.createdAt.toISOString(), updatedAt: row.task.updatedAt.toISOString(),
  }));
}
export const listNoteTasks = (actor: KnowledgeActor, options?: { sourceNoteId?: string; personalOnly?: boolean }) =>
  taskRows(actor, { sourceNoteId: options?.sourceNoteId, personalOnly: options?.personalOnly });
export const listBoardNoteTasks = (tx: KnowledgeTransaction, actor: KnowledgeActor, boardId: string) => taskRows(actor, { boardId }, "read", tx);
export async function getNoteTask(actor: KnowledgeActor, id: string, access: KnowledgeAccess = "read") {
  return (await taskRows(actor, { id }, access))[0] ?? null;
}

async function validateAssignee(tx: KnowledgeTransaction, actor: KnowledgeActor, resourceId: string, userId: string | null, share: boolean) {
  if (!userId) return;
  const [member] = await tx.select({ role: schema.roles.name, roleId: schema.roles.id }).from(schema.allianceMemberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId))
    .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.hqUsers.id, userId), eq(schema.allianceMemberships.status, "active"))).for("share");
  if (!member) throw new KnowledgeAccessError("invalid");
  const target: KnowledgeActor = { kind: "web", allianceId: actor.allianceId, hqUserId: userId, discordUserId: null, isOfficer: ["owner", "maintainer", "officer"].includes(member.role), readableBoardIds: [], editableBoardIds: [] };
  if (target.isOfficer) {
    const [permission] = await tx.select({ id: schema.rolePermissions.permissionId }).from(schema.rolePermissions).where(and(eq(schema.rolePermissions.roleId, member.roleId), eq(schema.rolePermissions.permissionId, "notes_boards:read")));
    if (permission) {
      const boards = await tx.select({ id: schema.knowledgeBoards.id }).from(schema.knowledgeBoards)
        .innerJoin(schema.knowledgeResources, and(eq(schema.knowledgeResources.id, schema.knowledgeBoards.resourceId), eq(schema.knowledgeResources.allianceId, actor.allianceId), isNull(schema.knowledgeResources.archivedAt)))
        .where(and(eq(schema.knowledgeBoards.allianceId, actor.allianceId), knowledgeAccessCondition(target, schema.knowledgeBoards.resourceId)));
      target.readableBoardIds = boards.map((board) => board.id);
    }
  }
  const [allowed] = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resourceId), knowledgeAccessCondition(target, resources.id)));
  if (allowed) return;
  const [owned] = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resourceId), knowledgeAccessCondition(actor, resources.id, "share")));
  if (!share || !owned) throw new KnowledgeAccessError("assignee_access");
  await tx.insert(schema.knowledgeResourceGrants).values({ id: nanoid(), resourceId, allianceId: actor.allianceId, subjectKind: "user", subjectId: userId, role: "read", createdByHqUserId: actor.hqUserId })
    .onConflictDoNothing({ target: [schema.knowledgeResourceGrants.resourceId, schema.knowledgeResourceGrants.subjectKind, schema.knowledgeResourceGrants.subjectId] });
  await tx.update(resources).set({ accessVersion: sql`${resources.accessVersion} + 1` }).where(eq(resources.id, resourceId));
}

async function syncTaskReminder(tx: KnowledgeTransaction, actor: KnowledgeActor, task: typeof tasks.$inferSelect, archived: boolean) {
  await tx.update(schema.inboxReminderItems).set({ active: 0 }).where(and(eq(schema.inboxReminderItems.allianceId, actor.allianceId), eq(schema.inboxReminderItems.kind, "officer_action_item_due"), eq(schema.inboxReminderItems.resourceId, task.id)));
  if (archived || !task.dueAt || task.status === "done" || task.status === "cancelled") return;
  await tx.insert(schema.inboxReminderItems).values({
    id: nanoid(), allianceId: actor.allianceId, kind: "officer_action_item_due", title: task.title,
    href: `/notes?view=tasks&task=${task.id}`, visibleAfter: task.dueAt, requiredPermission: "notes:read", active: 1, resourceId: task.id,
  });
}

export async function createNoteTaskInTransaction(tx: KnowledgeTransaction, actor: KnowledgeActor, input: TaskCreate, capture?: { key: string; actionKey: string }) {
  if (input.sourceNoteId) {
    const [source] = await tx.select({ id: schema.performanceNotes.id }).from(schema.performanceNotes).where(and(eq(schema.performanceNotes.id, input.sourceNoteId), eq(schema.performanceNotes.allianceId, actor.allianceId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(actor, schema.performanceNotes.resourceId, "edit")));
    if (!source) throw new KnowledgeAccessError("not_found");
  }
  const id = nanoid();
  const resourceId = await createKnowledgeResource(tx, actor, "task", id);
  await validateAssignee(tx, actor, resourceId, input.assigneeHqUserId, input.shareWithAssignee);
  const [task] = await tx.insert(tasks).values({
    id, resourceId, allianceId: actor.allianceId, sourceNoteId: input.sourceNoteId,
    title: input.title, description: input.description, status: input.status, priority: input.priority, labels: input.labels,
    assigneeHqUserId: input.assigneeHqUserId, dueAt: input.dueAt ? new Date(input.dueAt) : null,
    completedAt: taskCompletedAt(input.status, null, new Date()), createdByHqUserId: actor.hqUserId,
    captureKey: capture?.key, actionKey: capture?.actionKey,
  }).returning();
  await syncTaskReminder(tx, actor, task, false);
  return id;
}

export async function createNoteTask(actor: KnowledgeActor, input: TaskCreate) {
  const result = await withKnowledgeReceipt(actor, "notes.task_create", input.requestId ?? nanoid(), input, async (tx) => ({ taskId: await createNoteTaskInTransaction(tx, actor, input) }));
  const task = await getNoteTask(actor, result.taskId!);
  if (!task) throw new KnowledgeAccessError("not_found");
  return task;
}

type TaskMutation = TaskPatch & { legacyAssigneeAllianceMemberId?: string | null; dueHint?: string | null };
export async function updateNoteTaskInTransaction(tx: KnowledgeTransaction, actor: KnowledgeActor, id: string, input: TaskMutation) {
    const [row] = await tx.select({ resourceId: tasks.resourceId }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.allianceId, actor.allianceId)));
    if (!row) throw new KnowledgeAccessError("not_found");
    const resource = await lockKnowledgeResource(tx, actor, row.resourceId);
    if (resource.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    await lockTaskBoards(tx, id);
    if (input.archived !== undefined && !knowledgeActorOwnsResource(actor, resource)) throw new KnowledgeAccessError("forbidden");
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.allianceId, actor.allianceId))).for("update");
    if (input.assigneeHqUserId !== undefined) await validateAssignee(tx, actor, resource.id, input.assigneeHqUserId, input.shareWithAssignee === true);
    let legacyName: string | null | undefined;
    if (input.legacyAssigneeAllianceMemberId) {
      const [member] = await tx.select({ name: schema.allianceMembers.currentName }).from(schema.allianceMembers).where(and(eq(schema.allianceMembers.id, input.legacyAssigneeAllianceMemberId), eq(schema.allianceMembers.allianceId, actor.allianceId)));
      if (!member) throw new KnowledgeAccessError("invalid");
      legacyName = member.name;
    } else if (input.legacyAssigneeAllianceMemberId === null) legacyName = null;
    const status = input.status ?? current.status as TaskStatus;
    const [updated] = await tx.update(tasks).set({
      title: input.title, description: input.description, status, priority: input.priority, labels: input.labels,
      intakeProvenance: current.intakeProvenance ? { ...current.intakeProvenance, modes: { ...current.intakeProvenance.modes, ...Object.fromEntries(["title", "description", "status", "priority"].filter((key) => input[key as keyof TaskMutation] !== undefined).map((key) => [key, "manual" as const])) } } : undefined,
      assigneeAllianceMemberId: input.legacyAssigneeAllianceMemberId, assigneeNameRaw: legacyName, dueHint: input.dueHint,
      assigneeHqUserId: input.assigneeHqUserId, dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
      completedAt: taskCompletedAt(status, current.completedAt, new Date()), updatedAt: new Date(),
    }).where(and(eq(tasks.id, id), eq(tasks.allianceId, actor.allianceId))).returning();
    if (input.archived !== undefined) await tx.update(resources).set({ archivedAt: input.archived ? new Date() : null }).where(eq(resources.id, resource.id));
    await touchKnowledgeResource(tx, resource.id);
    await syncTaskReminder(tx, actor, updated, input.archived ?? resource.archivedAt !== null);
    await touchTaskBoards(tx, id);
    return { taskId: id };
}

export async function updateNoteTask(actor: KnowledgeActor, id: string, input: TaskMutation) {
  const task = await getNoteTask(actor, id, "edit");
  if (!task) throw new KnowledgeAccessError("not_found");
  await withKnowledgeReceipt(actor, "notes.task_update", input.requestId ?? nanoid(), { id, ...input }, (tx) => updateNoteTaskInTransaction(tx, actor, id, input));
  return getNoteTask(actor, id);
}

export async function commitNoteCapture(actor: KnowledgeActor, input: CaptureCommit) {
  const included = input.tasks.filter((task) => task.included);
  return withKnowledgeReceipt(actor, "notes.capture", input.requestId, input, async (tx, receiptId) => {
    if (new Set(included.map((task) => task.actionKey)).size !== included.length || included.some((task) => task.evidence && !redactIntakeText(input.body).includes(task.evidence))) throw new KnowledgeAccessError("invalid");
    const noteId = await createPerformanceNoteInTransaction(tx, { ...input, actor, intakeMode: input.kind === "note" ? "thought" : "batch" });
    const taskIds: string[] = [];
    for (const task of included) taskIds.push(await createNoteTaskInTransaction(tx, actor, { ...task, sourceNoteId: noteId, assigneeHqUserId: null, shareWithAssignee: false }, { key: receiptId, actionKey: task.actionKey }));
    return { noteId, taskIds };
  });
}

export async function readableTaskIds(actor: KnowledgeActor, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await getDb().select({ id: tasks.id }).from(tasks).where(and(eq(tasks.allianceId, actor.allianceId), inArray(tasks.id, ids), knowledgeAccessCondition(actor, tasks.resourceId)));
  return new Set(rows.map((row) => row.id));
}
