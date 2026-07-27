import "server-only";

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { isTimeOffEntryKind, serializeTimeOffEntry } from "./api.shared";
import {
  canManageTimeOffEntry,
  parseTimeOffDraft,
  timeOffEntryForViewer,
  TimeOffError,
  type TimeOffDraft,
  type TimeOffViewer,
} from "./workflow.shared";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Entry = typeof schema.memberTimeOff.$inferSelect;

export type TimeOffActor = TimeOffViewer & {
  allianceId: string;
  hqUserId?: string | null;
  discordUserId?: string | null;
  sessionId?: string | null;
  refresh?: () => Promise<TimeOffActor>;
};

function assertActor(actor: TimeOffActor) {
  if (!actor.allianceId || (!actor.hqUserId && !actor.discordUserId)) throw new TimeOffError("forbidden", 403);
}

async function refreshActor(actor: TimeOffActor): Promise<TimeOffActor> {
  const refreshed = actor.refresh ? await actor.refresh() : actor;
  if (refreshed.allianceId !== actor.allianceId || (refreshed.hqUserId ?? null) !== (actor.hqUserId ?? null) || (refreshed.discordUserId ?? null) !== (actor.discordUserId ?? null)) throw new TimeOffError("forbidden", 403);
  assertActor(refreshed);
  return refreshed;
}

function assertEntryAccess(actor: TimeOffActor, entry: { ashedMemberId: string; entryKind: string }) {
  assertActor(actor);
  if (!canManageTimeOffEntry({
    entryKind: entry.entryKind,
    canManageOthers: actor.canManageOthers,
    ownsCommander: actor.ownedCommanderIds.includes(entry.ashedMemberId),
  })) throw new TimeOffError("forbidden", 403);
}

async function loadRosterMember(tx: Transaction, actor: TimeOffActor, draft: TimeOffDraft) {
  assertEntryAccess(actor, draft);
  const [member] = await tx.select({ name: schema.allianceMembers.currentName, status: schema.allianceMembers.status })
    .from(schema.allianceMembers)
    .where(and(eq(schema.allianceMembers.allianceId, actor.allianceId), eq(schema.allianceMembers.ashedMemberId, draft.ashedMemberId)))
    .limit(1);
  if (!member || member.status === "former") throw new TimeOffError("commanderUnavailable", 400);
  return member;
}

async function appendRevision(tx: Transaction, actor: TimeOffActor, row: Entry) {
  if (!isTimeOffEntryKind(row.entryKind)) throw new TimeOffError("forbidden", 403);
  await tx.insert(schema.memberTimeOffRevisions).values({
    id: nanoid(),
    entryId: row.id,
    allianceId: row.allianceId,
    version: row.version,
    snapshot: {
      startDate: row.startDate,
      endDate: row.endDate,
      entryKind: row.entryKind,
      globalAbsence: row.globalAbsence,
      cancelled: row.cancelledAt != null,
    },
    recordedByHqUserId: actor.hqUserId ?? null,
    recordedByDiscordUserId: actor.discordUserId ?? null,
    recordedAt: row.updatedAt,
  });
}

async function loadLockedEntry(tx: Transaction, actor: TimeOffActor, id: string, version: unknown) {
  assertActor(actor);
  const [entry] = await tx.select().from(schema.memberTimeOff)
    .where(and(eq(schema.memberTimeOff.id, id), eq(schema.memberTimeOff.allianceId, actor.allianceId)))
    .limit(1).for("update");
  if (!entry) throw new TimeOffError("entryUnavailable", 404);
  assertEntryAccess(actor, entry);
  if (!Number.isSafeInteger(version) || version !== entry.version) throw new TimeOffError("staleEntry", 409);
  return { entry, actor };
}

function serializeForActor(row: Entry, actor: TimeOffActor) {
  return timeOffEntryForViewer(serializeTimeOffEntry(row), actor);
}

export async function previewTimeOff(actor: TimeOffActor, body: unknown) {
  const draft = parseTimeOffDraft(body);
  return getDb().transaction(async (tx) => {
    const member = await loadRosterMember(tx, actor, draft);
    return { ...draft, memberName: member.name };
  });
}

export async function createTimeOff(actor: TimeOffActor, body: unknown, requestId: unknown) {
  actor = await refreshActor(actor);
  assertActor(actor);
  const draft = parseTimeOffDraft(body);
  assertEntryAccess(actor, draft);
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw new TimeOffError("expired", 400);
  const requestKey = createHash("sha256").update(JSON.stringify([actor.allianceId, actor.discordUserId ? "discord" : "hq", actor.discordUserId ?? actor.hqUserId, requestId])).digest("hex");
  const requestHash = createHash("sha256").update(JSON.stringify(draft)).digest("hex");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`);
    const [existing] = await tx.select().from(schema.memberTimeOff).where(eq(schema.memberTimeOff.requestKey, requestKey)).limit(1);
    if (existing) {
      assertEntryAccess(actor, existing);
      if (existing.requestHash !== requestHash) throw new TimeOffError("staleEntry", 409);
      return serializeForActor(existing, actor);
    }
    const member = await loadRosterMember(tx, actor, draft);
    const now = new Date();
    const [row] = await tx.insert(schema.memberTimeOff).values({
      ...draft,
      id: nanoid(),
      allianceId: actor.allianceId,
      memberName: member.name,
      availability: "full_away",
      globalAbsence: true,
      version: 1,
      source: actor.discordUserId ? "discord" : actor.canManageOthers ? "officer" : "web",
      createdByHqUserId: actor.hqUserId ?? null,
      createdByDiscordUserId: actor.discordUserId ?? null,
      requestKey,
      requestHash,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await appendRevision(tx, actor, row!);
    return serializeForActor(row!, actor);
  });
}

export async function updateTimeOff(actor: TimeOffActor, id: string, body: unknown, version: unknown) {
  actor = await refreshActor(actor);
  const draft = parseTimeOffDraft(body);
  return getDb().transaction(async (tx) => {
    const locked = await loadLockedEntry(tx, actor, id, version);
    const existing = locked.entry;
    actor = locked.actor;
    if (existing.cancelledAt) throw new TimeOffError("entryUnavailable", 409);
    if (draft.ashedMemberId !== existing.ashedMemberId) throw new TimeOffError("forbidden", 403);
    const member = await loadRosterMember(tx, actor, draft);
    const [row] = await tx.update(schema.memberTimeOff).set({
      ...draft,
      memberName: member.name,
      availability: "full_away",
      globalAbsence: true,
      version: existing.version + 1,
      updatedAt: new Date(),
    }).where(eq(schema.memberTimeOff.id, existing.id)).returning();
    await appendRevision(tx, actor, row!);
    return serializeForActor(row!, actor);
  });
}

export async function cancelTimeOff(actor: TimeOffActor, id: string, version: unknown) {
  actor = await refreshActor(actor);
  return getDb().transaction(async (tx) => {
    const locked = await loadLockedEntry(tx, actor, id, version);
    const existing = locked.entry;
    actor = locked.actor;
    if (existing.cancelledAt) return serializeForActor(existing, actor);
    const now = new Date();
    const [row] = await tx.update(schema.memberTimeOff).set({
      cancelledAt: now,
      updatedAt: now,
      version: existing.version + 1,
    }).where(eq(schema.memberTimeOff.id, existing.id)).returning();
    await appendRevision(tx, actor, row!);
    return serializeForActor(row!, actor);
  });
}
