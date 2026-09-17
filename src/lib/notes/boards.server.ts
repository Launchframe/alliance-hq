import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { loadBoard as loadSupportBoard } from "@/lib/support-teams/repository.server";
import { fieldKey, memberTeam, readField, teamIds } from "@/lib/support-teams/policy.shared";
import type { KnowledgeWebActor } from "./access.server";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, recheckKnowledgeActor, touchKnowledgeResource, type KnowledgeTransaction } from "./resources.server";
import { withKnowledgeReceipt } from "./mutations.server";
import { createNoteTaskInTransaction, listBoardNoteTasks, updateNoteTaskInTransaction } from "./tasks.server";
import { listKnowledgePeople } from "./sharing.server";
import { advanceNoteBoard, lockTaskBoards, touchTaskBoards } from "./board-events.server";
import { orderBoardTasks, type NoteBoardCommand, type NoteBoardSnapshot } from "./board.shared";

const boards = schema.knowledgeBoards;
const items = schema.knowledgeBoardItems;

export async function assertBoardActor(tx: KnowledgeTransaction, actor: KnowledgeWebActor, write = false) {
  await recheckKnowledgeActor(tx, actor);
  if (actor.kind !== "web" || !actor.isOfficer || !actor.canReadBoards || write && !actor.canWriteBoards) throw new KnowledgeAccessError("forbidden");
  const required = write ? ["notes_boards:read", "notes_boards:write"] : ["notes_boards:read"];
  const permissions = await tx.select({ id: schema.rolePermissions.permissionId }).from(schema.allianceMemberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.allianceMemberships.roleId))
    .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.hqUserId, actor.hqUserId!), eq(schema.allianceMemberships.status, "active"), inArray(schema.roles.name, ["owner", "maintainer", "officer"]), inArray(schema.rolePermissions.permissionId, required))).for("share");
  if (new Set(permissions.map((row) => row.id)).size !== required.length) throw new KnowledgeAccessError("forbidden");
}

async function boardRow(tx: KnowledgeTransaction, actor: KnowledgeWebActor, id: string, write = false) {
  await assertBoardActor(tx, actor, write);
  const query = tx.select({ id: boards.id, name: boards.name, version: boards.version, resourceId: boards.resourceId }).from(boards)
    .innerJoin(schema.knowledgeResources, and(eq(schema.knowledgeResources.id, boards.resourceId), isNull(schema.knowledgeResources.archivedAt)))
    .where(and(eq(boards.id, id), eq(boards.allianceId, actor.allianceId), knowledgeAccessCondition(actor, boards.resourceId, write ? "edit" : "read")));
  const [board] = write ? await query.for("update", { of: boards }) : await query;
  if (!board) throw new KnowledgeAccessError("not_found");
  return board;
}

export async function noteBoardVersion(actor: KnowledgeWebActor, id: string) {
  return getDb().transaction(async (tx) => (await boardRow(tx, actor, id)).version);
}

export async function listNoteBoards(actor: KnowledgeWebActor) {
  return getDb().transaction(async (tx) => {
    await assertBoardActor(tx, actor);
    return tx.select({ id: boards.id, name: boards.name, version: boards.version }).from(boards)
      .innerJoin(schema.knowledgeResources, and(eq(schema.knowledgeResources.id, boards.resourceId), isNull(schema.knowledgeResources.archivedAt)))
      .where(and(eq(boards.allianceId, actor.allianceId), knowledgeAccessCondition(actor, boards.resourceId))).orderBy(asc(boards.name));
  });
}

export async function createNoteBoard(actor: KnowledgeWebActor, input: { name: string; requestId: string }) {
  return withKnowledgeReceipt(actor, "notes.board_create", input.requestId, input, async (tx) => {
    await assertBoardActor(tx, actor, true);
    const id = nanoid();
    const resourceId = await createKnowledgeResource(tx, actor, "board", id);
    await tx.insert(boards).values({ id, allianceId: actor.allianceId, resourceId, name: input.name });
    await tx.insert(schema.knowledgeResourceGrants).values({ id: nanoid(), allianceId: actor.allianceId, resourceId, subjectKind: "officers", subjectId: actor.allianceId, role: "edit", createdByHqUserId: actor.hqUserId });
    return { boardId: id, version: 1 };
  });
}

export async function noteBoardSnapshot(actor: KnowledgeWebActor, id: string): Promise<NoteBoardSnapshot> {
  return getDb().transaction(async (tx) => {
    const board = await boardRow(tx, actor, id);
    const cards = await listBoardNoteTasks(tx, actor, id);
    const placements = await tx.select().from(items).where(and(eq(items.boardId, id), eq(items.allianceId, actor.allianceId)));
    const support = await loadSupportBoard(tx, actor.allianceId);
    const teams = support.published ? teamIds(support).map((id) => ({ id, name: String(readField(support, fieldKey("team", id, "name")) ?? id) })) : [];
    const links = teams.length ? await tx.select({ userId: schema.hqMemberLinks.hqUserId, memberId: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks).where(eq(schema.hqMemberLinks.allianceId, actor.allianceId)) : [];
    const teamForUser = (userId?: string) => {
      const assigned = new Set(links.filter((link) => link.userId === userId).map((link) => memberTeam(support, link.memberId)).filter((team) => team && teams.some((item) => item.id === team)));
      return assigned.size === 1 ? [...assigned][0] ?? null : null;
    };
    return { id: board.id, name: board.name, version: board.version, allianceId: actor.allianceId, principalId: actor.hqUserId!, canWrite: actor.canWriteBoards,
      tasks: cards.map((task) => ({ ...task, position: placements.find((item) => item.taskId === task.id)?.position ?? 0, teamId: task.assignee ? teamForUser(task.assignee.id) : null })).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
      people: await listKnowledgePeople(actor, true), teams };
  }, { isolationLevel: "repeatable read" });
}

async function placeTask(tx: KnowledgeTransaction, actor: KnowledgeWebActor, boardId: string, taskId: string, resourceId: string) {
  const existing = await tx.select({ id: items.taskId, position: items.position }).from(items).where(and(eq(items.boardId, boardId), eq(items.allianceId, actor.allianceId)));
  if (existing.some((item) => item.id === taskId)) throw new KnowledgeAccessError("changed");
  if (existing.length >= 200) throw new KnowledgeAccessError("invalid");
  const grantId = nanoid();
  await tx.insert(schema.knowledgeResourceGrants).values({ id: grantId, allianceId: actor.allianceId, resourceId, subjectKind: "board", subjectId: boardId, role: "edit", createdByHqUserId: actor.hqUserId });
  await tx.insert(items).values({ boardId, taskId, allianceId: actor.allianceId, grantId, position: Math.max(0, ...existing.map((item) => item.position)) + 1, sharedByHqUserId: actor.hqUserId });
  await tx.update(schema.knowledgeResources).set({ accessVersion: sql`${schema.knowledgeResources.accessVersion} + 1` }).where(eq(schema.knowledgeResources.id, resourceId));
  await touchKnowledgeResource(tx, resourceId);
  await touchTaskBoards(tx, taskId, boardId);
}

export async function executeNoteBoardCommand(actor: KnowledgeWebActor, boardId: string, command: NoteBoardCommand) {
  return withKnowledgeReceipt(actor, "notes.board_command", command.requestId, { boardId, command }, async (tx) => {
    await assertBoardActor(tx, actor, true);
    let taskResource: Awaited<ReturnType<typeof lockKnowledgeResource>> | undefined;
    if ("taskId" in command) {
      const [task] = await tx.select({ resourceId: schema.officerActionItems.resourceId }).from(schema.officerActionItems).where(and(eq(schema.officerActionItems.id, command.taskId), eq(schema.officerActionItems.allianceId, actor.allianceId)));
      if (!task) throw new KnowledgeAccessError("not_found");
      taskResource = await lockKnowledgeResource(tx, actor, task.resourceId, command.kind === "move" ? "edit" : "share");
      if (taskResource.version !== command.expectedTaskVersion) throw new KnowledgeAccessError("changed");
      await lockTaskBoards(tx, command.taskId, [boardId]);
    }
    const board = await boardRow(tx, actor, boardId, true);
    if (board.version !== command.expectedVersion) throw new KnowledgeAccessError("changed");
    if (command.kind === "rename") await tx.update(boards).set({ name: command.name }).where(eq(boards.id, boardId));
    if (command.kind === "create") {
      if (!actor.canCreate) throw new KnowledgeAccessError("forbidden");
      const id = await createNoteTaskInTransaction(tx, actor, { ...command.task, sourceNoteId: null, assigneeHqUserId: null, shareWithAssignee: false });
      await placeTask(tx, actor, boardId, id, `task:${id}`);
      if (command.task.assigneeHqUserId) {
        const [resource] = await tx.select({ version: schema.knowledgeResources.version }).from(schema.knowledgeResources).where(eq(schema.knowledgeResources.id, `task:${id}`));
        await updateNoteTaskInTransaction(tx, actor, id, { expectedVersion: resource.version, assigneeHqUserId: command.task.assigneeHqUserId, shareWithAssignee: command.task.shareWithAssignee });
        const [current] = await tx.select({ version: boards.version }).from(boards).where(eq(boards.id, boardId));
        return { boardId, version: current.version };
      }
    }
    if (command.kind === "share") await placeTask(tx, actor, boardId, command.taskId, taskResource!.id);
    if (command.kind === "remove" || command.kind === "move") {
      const [placement] = await tx.select().from(items).where(and(eq(items.boardId, boardId), eq(items.taskId, command.taskId), eq(items.allianceId, actor.allianceId)));
      if (!placement) throw new KnowledgeAccessError("not_found");
      if (command.kind === "remove") {
        await tx.delete(schema.knowledgeResourceGrants).where(eq(schema.knowledgeResourceGrants.id, placement.grantId));
        await tx.update(schema.knowledgeResources).set({ accessVersion: sql`${schema.knowledgeResources.accessVersion} + 1` }).where(eq(schema.knowledgeResources.id, taskResource!.id));
        await touchKnowledgeResource(tx, taskResource!.id);
        await touchTaskBoards(tx, command.taskId, boardId);
      } else {
        await updateNoteTaskInTransaction(tx, actor, command.taskId, { expectedVersion: command.expectedTaskVersion, status: command.status });
        const lane = await tx.select({ id: items.taskId }).from(items).innerJoin(schema.officerActionItems, eq(schema.officerActionItems.id, items.taskId))
          .where(and(eq(items.boardId, boardId), eq(items.allianceId, actor.allianceId), eq(schema.officerActionItems.status, command.status))).orderBy(asc(items.position), asc(items.taskId));
        let ordered: string[];
        try { ordered = orderBoardTasks(lane.map((item) => item.id), command.taskId, command.beforeTaskId); } catch { throw new KnowledgeAccessError("invalid"); }
        for (const [position, id] of ordered.entries()) await tx.update(items).set({ position }).where(and(eq(items.boardId, boardId), eq(items.taskId, id)));
        const [current] = await tx.select({ version: boards.version }).from(boards).where(eq(boards.id, boardId));
        return { boardId, version: current.version };
      }
    }
    return { boardId, version: await advanceNoteBoard(tx, boardId) };
  });
}
