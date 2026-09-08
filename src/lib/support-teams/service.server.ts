import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireSupportAccess, type SupportAccess } from "./access.server";
import { applyCommand, balancedTargets, memberTeam, readField, fieldKey, teamIds, teamLead } from "./policy.shared";
import { activeReversals, confirmUndo, historyPage, previewUndo } from "./history.shared";
import { advanceDraft } from "./draft.shared";
import { withDraftStintTokens } from "./draft-roster.server";
import { persistDraftNotice } from "./draft-notice.server";
import { loadBoard, loadHistory, lockBoard, persistEvent, recheckActor, type SupportTransaction } from "./repository.server";
import { loadSupportRoster } from "./roster.server";
import { SupportError, type SupportCommand, type SupportEvent, type SupportSnapshot, type UndoPreview } from "./types.shared";

export async function supportSnapshot(access: SupportAccess): Promise<SupportSnapshot> {
  return getDb().transaction(async (db) => {
    const board = await loadBoard(db, access.actor.allianceId);
    if (!access.actor.canRead && !board.published) return { version: board.version, published: false, teams: [], roster: [], linkedMemberIds: access.actor.linkedMemberIds, canWrite: false };
    const roster = await loadSupportRoster(access.actor.allianceId, db);
    const ids = teamIds(board);
    const targets = balancedTargets(roster.length, ids);
    const teams = ids.map((id) => ({ id, name: readField(board, fieldKey("team", id, "name")) as string | null, leadId: teamLead(board, id), target: targets[id], memberIds: roster.filter((member) => memberTeam(board, member.id) === id).map((member) => member.id), needsReplacement: !roster.some((member) => member.id === teamLead(board, id) && (member.rank === 4 || member.rank === 5)) }));
    return { version: board.version, published: board.published, teams, roster, linkedMemberIds: access.actor.linkedMemberIds, canWrite: access.actor.canWrite, ...(access.actor.canRead ? { board, actor: access.actor } : {}) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
async function currentLinks(db: SupportTransaction, access: SupportAccess) {
  const actor = access.actor;
  const legacy = await db.select({ memberId: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks).where(and(eq(schema.hqMemberLinks.allianceId, actor.allianceId), eq(schema.hqMemberLinks.hqUserId, actor.principalId))).for("share");
  const canonical = await db.select({ memberId: schema.commanderAllianceMemberships.ashedMemberId }).from(schema.hqUserCommanders)
    .innerJoin(schema.commanderAllianceMemberships, eq(schema.commanderAllianceMemberships.commanderId, schema.hqUserCommanders.commanderId))
    .where(and(eq(schema.hqUserCommanders.hqUserId, actor.principalId), eq(schema.commanderAllianceMemberships.allianceId, actor.allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt))).for("share");
  const [user] = await db.select({ displayName: schema.hqUsers.displayName }).from(schema.hqUsers).where(eq(schema.hqUsers.id, actor.principalId));
  return { ...actor, displayName: user?.displayName ?? null, linkedMemberIds: [...new Set([...legacy, ...canonical].map((row) => row.memberId))] };
}
export async function mutate(access: SupportAccess, intent: unknown, idempotencyKey: string, operation: (board: Awaited<ReturnType<typeof loadBoard>>, events: SupportEvent[], roster: Awaited<ReturnType<typeof loadSupportRoster>>, actor: SupportAccess["actor"], identity: { id: string; at: string; idempotencyKey: string }) => { board: Awaited<ReturnType<typeof loadBoard>>; event: SupportEvent }) {
  const fresh = await requireSupportAccess("write");
  if (fresh.actor.principalId !== access.actor.principalId || fresh.actor.allianceId !== access.actor.allianceId || !fresh.actor.canWrite) throw new SupportError("forbidden");
  const requestHash = createHash("sha256").update(JSON.stringify(intent)).digest("hex");
  return getDb().transaction(async (db) => {
    await lockBoard(db, fresh.actor.allianceId);
    await recheckActor(db, fresh.actor, fresh.sessionId);
    const [prior] = await db.select({ requestHash: schema.supportTeamEvents.requestHash, event: schema.supportTeamEvents.event }).from(schema.supportTeamEvents)
      .where(and(eq(schema.supportTeamEvents.allianceId, fresh.actor.allianceId), eq(schema.supportTeamEvents.principalId, fresh.actor.principalId), eq(schema.supportTeamEvents.idempotencyKey, idempotencyKey)));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new SupportError("changed");
      const current = await loadBoard(db, fresh.actor.allianceId);
      return { event: prior.event, version: current.version, replayed: true };
    }
    await db.select({ id: schema.allianceMembers.id }).from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, fresh.actor.allianceId)).for("share");
    const actor = await currentLinks(db, fresh);
    const board = await loadBoard(db, actor.allianceId);
    const events = await loadHistory(db, actor.allianceId);
    await db.select({ id: schema.memberAllianceTenure.id }).from(schema.memberAllianceTenure).where(eq(schema.memberAllianceTenure.allianceId, actor.allianceId)).for("share");
    await db.select({ id: schema.commanderAllianceMemberships.id }).from(schema.commanderAllianceMemberships).where(eq(schema.commanderAllianceMemberships.allianceId, actor.allianceId)).for("share");
    const roster = await withDraftStintTokens(db, actor.allianceId, await loadSupportRoster(actor.allianceId, db));
    const clock = await db.execute(sql`select clock_timestamp() as now`);
    const at = new Date(clock[0].now as string | Date).toISOString();
    const result = operation(board, events, roster, actor, { id: randomUUID(), at, idempotencyKey });
    result.event.memberNames = Object.fromEntries(roster.filter((member) => result.event.memberIds.includes(member.id)).map((member) => [member.id, member.name]));
    await persistEvent(db, result.board, result.event, requestHash);
    await persistDraftNotice(db, result.board, result.event, events);
    const draftId = result.board.construction?.kind === "draft" ? result.board.construction.id : null;
    const automatic = draftId && ["draftPick", "extendDraft"].includes(result.event.kind) ? advanceDraft(result.board, roster, draftId, result.event.id, { id: randomUUID(), at, idempotencyKey: `advance:${result.event.id}` }) : null;
    if (automatic) await persistEvent(db, automatic.board, automatic.event, createHash("sha256").update(result.event.id).digest("hex"));
    return { event: result.event, version: automatic?.board.version ?? result.board.version, replayed: false };
  });
}
export async function executeSupportCommand(access: SupportAccess, command: SupportCommand, idempotencyKey: string) {
  return mutate(access, command, idempotencyKey, (board, events, roster, actor, identity) => {
    const result = applyCommand(board, roster, actor, command, identity);
    if (!actor.override && (command.kind === "move" || command.kind === "swap")) {
      for (const patch of result.event.patches) {
        const writer = events.find((event) => event.id === board.fields[patch.key]?.actionId);
        if (writer && writer.principalId !== actor.principalId && writer.patches.some((prior) => prior.key === patch.key && prior.before === patch.after && prior.after === patch.before)) throw new SupportError("forbidden");
      }
    }
    return result;
  });
}
export async function executeSupportUndo(access: SupportAccess, preview: Omit<UndoPreview, "patches">, idempotencyKey: string) {
  return mutate(access, preview, idempotencyKey, (board, events, roster, actor, identity) => confirmUndo(board, events, roster, actor, { ...preview, patches: [] }, identity));
}
export async function loadUndoPreview(access: SupportAccess, actionId: string) {
  if (!access.actor.canWrite || !access.actor.canRead) throw new SupportError("forbidden");
  return getDb().transaction(async (db) => previewUndo(await loadBoard(db, access.actor.allianceId), await loadHistory(db, access.actor.allianceId), await withDraftStintTokens(db, access.actor.allianceId, await loadSupportRoster(access.actor.allianceId, db)), access.actor, actionId), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function loadSupportHistory(access: SupportAccess, filter: Parameters<typeof historyPage>[1]) {
  if (!access.actor.canRead) throw new SupportError("forbidden");
  return getDb().transaction(async (db) => {
    const events = await loadHistory(db, access.actor.allianceId);
    const board = await loadBoard(db, access.actor.allianceId);
    const roster = await withDraftStintTokens(db, access.actor.allianceId, await loadSupportRoster(access.actor.allianceId, db));
    const page = historyPage(events, filter);
    return { ...page, events: page.events.map((event) => {
      let undoBlocked: string | null = null;
      try { previewUndo(board, events, roster, access.actor, event.id); } catch (error) { undoBlocked = error instanceof SupportError ? error.code : "invalid"; }
      return { ...event, undoBlocked, reversalId: activeReversals(events).get(event.id) ?? null };
    }) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
