import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireSupportAccess, type SupportAccess } from "./access.server";
import { balancedTargets, memberTeam, readField, fieldKey, teamIds, teamLead } from "./policy.shared";
import { activeReversals, confirmUndo, historyPage, previewUndo } from "./history.shared";
import { advanceDraft } from "./draft.shared";
import { withDraftStintTokens } from "./draft-roster.server";
import { persistDraftNotice } from "./draft-notice.server";
import { loadBoard, loadHistory, lockBoard, persistEvent, recheckActor, type SupportTransaction } from "./repository.server";
import { loadSupportRoster, loadSupportStints } from "./roster.server";
import { applyStintCommand, assertMembershipUndo, projectMemberships, publicBoard, publicEvent, publicUndoPreview, publicVersions, reconcileMemberships } from "./maintenance.server";
import { SupportError, type SupportBoard, type SupportCommand, type SupportEvent, type SupportRosterMember, type SupportSnapshot, type UndoPreview } from "./types.shared";

export async function supportSnapshot(access: SupportAccess): Promise<SupportSnapshot> {
  return getDb().transaction(async (db) => {
    const stored = await loadBoard(db, access.actor.allianceId);
    if (!access.actor.canRead && !stored.published) return { version: stored.version, published: false, teams: [], roster: [], linkedMemberIds: access.actor.linkedMemberIds, canWrite: false };
    const roster = await loadSupportRoster(access.actor.allianceId, db);
    const board = projectMemberships(stored, roster, await loadSupportStints(access.actor.allianceId, db));
    const ids = teamIds(board);
    const targets = balancedTargets(roster.length, ids);
    const teams = ids.map((id) => ({ id, name: readField(board, fieldKey("team", id, "name")) as string | null, leadId: teamLead(board, id), target: targets[id], memberIds: roster.filter((member) => memberTeam(board, member.id) === id).map((member) => member.id), needsReplacement: !roster.some((member) => member.id === teamLead(board, id) && (member.rank === 4 || member.rank === 5)) }));
    return { version: board.version, published: board.published, teams, roster, linkedMemberIds: access.actor.linkedMemberIds, canWrite: access.actor.canWrite, ...(access.actor.canRead ? { board: publicBoard(board), actor: access.actor } : {}) };
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
async function lockMembershipSources(db: SupportTransaction, allianceId: string) {
  await db.select({ id: schema.allianceMembers.id }).from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, allianceId)).for("share");
  await db.select({ id: schema.memberAllianceTenure.id }).from(schema.memberAllianceTenure).where(eq(schema.memberAllianceTenure.allianceId, allianceId)).for("share");
  await db.select({ id: schema.commanderAllianceMemberships.id }).from(schema.commanderAllianceMemberships).where(eq(schema.commanderAllianceMemberships.allianceId, allianceId)).for("share");
}
async function databaseTime(db: SupportTransaction) {
  const clock = await db.execute(sql`select clock_timestamp() as now`);
  return new Date(clock[0].now as string | Date).toISOString();
}
async function reconcileLocked(db: SupportTransaction, board: SupportBoard, roster: SupportRosterMember[], events: SupportEvent[], at: string) {
  const stints = await loadSupportStints(board.allianceId, db);
  const result = reconcileMemberships(board, roster, stints, { id: randomUUID(), at, idempotencyKey: `membership:${board.version}` });
  if (!result) return board;
  const names = Object.assign({}, ...events.map((event) => event.memberNames), result.event.memberNames) as Record<string, string>;
  result.event.memberNames = Object.fromEntries(result.event.memberIds.filter((id) => names[id]).map((id) => [id, names[id]]));
  await persistEvent(db, result.board, result.event, createHash("sha256").update(JSON.stringify(result.event.patches)).digest("hex"));
  events.push(result.event);
  return result.board;
}
export async function reconcileSupportMemberships(allianceId: string) {
  return getDb().transaction(async (db) => {
    const existing = await loadBoard(db, allianceId);
    if (!teamIds(existing).length) return { version: existing.version, reconciled: false };
    await lockBoard(db, allianceId);
    await lockMembershipSources(db, allianceId);
    const board = await loadBoard(db, allianceId);
    const next = await reconcileLocked(db, board, await loadSupportRoster(allianceId, db), await loadHistory(db, allianceId, 200), await databaseTime(db));
    return { version: next.version, reconciled: next.version !== board.version };
  });
}
export async function mutate(access: SupportAccess, intent: unknown, idempotencyKey: string, operation: (board: SupportBoard, events: SupportEvent[], roster: SupportRosterMember[], actor: SupportAccess["actor"], identity: { id: string; at: string; idempotencyKey: string }, originalVersion: number) => { board: SupportBoard; event: SupportEvent }) {
  const fresh = await requireSupportAccess("write");
  if (fresh.actor.principalId !== access.actor.principalId || fresh.actor.allianceId !== access.actor.allianceId || !fresh.actor.canWrite) throw new SupportError("forbidden");
  const requestHash = createHash("sha256").update(JSON.stringify(intent)).digest("hex");
  const outcome = await getDb().transaction(async (db) => {
    await lockBoard(db, fresh.actor.allianceId);
    await recheckActor(db, fresh.actor, fresh.sessionId);
    const [prior] = await db.select({ requestHash: schema.supportTeamEvents.requestHash, event: schema.supportTeamEvents.event }).from(schema.supportTeamEvents)
      .where(and(eq(schema.supportTeamEvents.allianceId, fresh.actor.allianceId), eq(schema.supportTeamEvents.principalId, fresh.actor.principalId), eq(schema.supportTeamEvents.idempotencyKey, idempotencyKey)));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new SupportError("changed");
      const current = await loadBoard(db, fresh.actor.allianceId);
      return { event: publicEvent(prior.event), version: current.version, replayed: true };
    }
    await lockMembershipSources(db, fresh.actor.allianceId);
    const actor = await currentLinks(db, fresh);
    const stored = await loadBoard(db, actor.allianceId);
    const events = await loadHistory(db, actor.allianceId);
    const roster = await withDraftStintTokens(db, actor.allianceId, await loadSupportRoster(actor.allianceId, db));
    const at = await databaseTime(db);
    const board = await reconcileLocked(db, stored, roster, events, at);
    let result: ReturnType<typeof operation>;
    try { result = operation(board, events, roster, actor, { id: randomUUID(), at, idempotencyKey }, stored.version); }
    catch (error) { if (error instanceof SupportError) return { error }; throw error; }
    result.event.memberNames = Object.fromEntries(roster.filter((member) => result.event.memberIds.includes(member.id)).map((member) => [member.id, member.name]));
    await persistEvent(db, result.board, result.event, requestHash);
    await persistDraftNotice(db, result.board, result.event, events);
    const draftId = result.board.construction?.kind === "draft" ? result.board.construction.id : null;
    const automatic = draftId && ["draftPick", "extendDraft"].includes(result.event.kind) ? advanceDraft(result.board, roster, draftId, result.event.id, { id: randomUUID(), at, idempotencyKey: `advance:${result.event.id}` }) : null;
    if (automatic) await persistEvent(db, automatic.board, automatic.event, createHash("sha256").update(result.event.id).digest("hex"));
    return { event: publicEvent(result.event), version: automatic?.board.version ?? result.board.version, replayed: false };
  });
  if ("error" in outcome) throw outcome.error;
  return outcome;
}
export async function executeSupportCommand(access: SupportAccess, command: SupportCommand, idempotencyKey: string) {
  return mutate(access, command, idempotencyKey, (board, events, roster, actor, identity, originalVersion) => {
    if (command.expectedVersion !== originalVersion || (originalVersion !== 0 && board.version !== originalVersion)) throw new SupportError("changed");
    const result = applyStintCommand(board, roster, actor, { ...command, expectedVersion: board.version }, identity);
    if (!actor.override && (command.kind === "move" || command.kind === "swap")) {
      for (const patch of result.event.patches) {
        const writer = events.find((event) => event.id === board.fields[patch.key]?.actionId);
        if (patch.before !== patch.after && writer && writer.principalId !== actor.principalId && writer.patches.some((prior) => prior.key === patch.key && prior.before === patch.after && prior.after === patch.before)) throw new SupportError("forbidden");
      }
    }
    return result;
  });
}
export async function executeSupportUndo(access: SupportAccess, expected: Omit<UndoPreview, "patches">, idempotencyKey: string) {
  return mutate(access, expected, idempotencyKey, (board, events, roster, actor, identity) => {
    const preview = previewUndo(board, events, roster, actor, expected.rootActionId, Date.parse(identity.at));
    assertMembershipUndo(preview, events);
    const versions = publicVersions(preview.expectedVersions);
    if (Object.keys(versions).length !== Object.keys(expected.expectedVersions).length || Object.entries(versions).some(([key, version]) => expected.expectedVersions[key] !== version) || JSON.stringify(preview.actionIds) !== JSON.stringify(expected.actionIds)) throw new SupportError("changed");
    return confirmUndo(board, events, roster, actor, preview, identity);
  });
}
export async function loadUndoPreview(access: SupportAccess, actionId: string) {
  if (!access.actor.canWrite || !access.actor.canRead) throw new SupportError("forbidden");
  return getDb().transaction(async (db) => {
    const roster = await withDraftStintTokens(db, access.actor.allianceId, await loadSupportRoster(access.actor.allianceId, db));
    const board = projectMemberships(await loadBoard(db, access.actor.allianceId), roster, await loadSupportStints(access.actor.allianceId, db));
    const events = await loadHistory(db, access.actor.allianceId);
    const preview = previewUndo(board, events, roster, access.actor, actionId, Date.parse(await databaseTime(db)));
    assertMembershipUndo(preview, events);
    return publicUndoPreview(preview);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function loadSupportHistory(access: SupportAccess, filter: Parameters<typeof historyPage>[1]) {
  if (!access.actor.canRead) throw new SupportError("forbidden");
  return getDb().transaction(async (db) => {
    const events = await loadHistory(db, access.actor.allianceId);
    const roster = await withDraftStintTokens(db, access.actor.allianceId, await loadSupportRoster(access.actor.allianceId, db));
    const board = projectMemberships(await loadBoard(db, access.actor.allianceId), roster, await loadSupportStints(access.actor.allianceId, db));
    const page = historyPage(events.map(publicEvent), filter);
    const reversed = activeReversals(events);
    const now = Date.parse(await databaseTime(db));
    return { ...page, events: page.events.map((event) => {
      let undoBlocked: string | null = null;
      try { assertMembershipUndo(previewUndo(board, events, roster, access.actor, event.id, now), events); } catch (error) { undoBlocked = error instanceof SupportError ? error.code : "invalid"; }
      return { ...event, undoBlocked, reversalId: reversed.get(event.id) ?? null };
    }) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
