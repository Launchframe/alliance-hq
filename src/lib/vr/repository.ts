import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { buildFlagReason, peerMaxExcludingMember } from "@/lib/vr/anomaly";
import type { LinkPendingState, VrPendingState } from "@/lib/vr/types";

const PENDING_TTL_MS = 30 * 60 * 1000;

function parseVrPending(value: unknown): VrPendingState | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "anomaly_confirm") {
    return {
      kind: "anomaly_confirm",
      proposedVr: Number(r.proposedVr),
      ashedMemberId: String(r.ashedMemberId),
    };
  }
  if (r.kind === "pick_character" && Array.isArray(r.linkIds)) {
    return { kind: "pick_character", linkIds: r.linkIds.map(String) };
  }
  return null;
}

function parseLinkPending(value: unknown): LinkPendingState | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "link_walkthrough" && typeof r.step === "number") {
    return { kind: "link_walkthrough", step: r.step };
  }
  if (r.kind === "link_fuzzy_pick" && Array.isArray(r.candidates)) {
    return {
      kind: "link_fuzzy_pick",
      candidates: r.candidates as Array<{ memberId: string; name: string }>,
      gameUid: String(r.gameUid),
      gameUserName: String(r.gameUserName),
      reportedName: String(r.reportedName),
    };
  }
  return null;
}

/** Match DISCORD_ALLIANCE_ID to HQ alliances.id (direct id or ashed_alliance_id). */
export function matchAllianceIdEnvValue(
  raw: string,
  candidates: ReadonlyArray<{ id: string; ashedAllianceId: string | null }>,
): string | null {
  const trimmed = raw.trim();
  const byId = candidates.find((row) => row.id === trimmed);
  if (byId) return byId.id;
  const byAshed = candidates.find((row) => row.ashedAllianceId === trimmed);
  return byAshed?.id ?? null;
}

export async function resolveDiscordAllianceId(): Promise<string | null> {
  const raw = process.env.DISCORD_ALLIANCE_ID?.trim();
  if (!raw) return null;

  const db = getDb();
  const [row] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(
      or(
        eq(schema.alliances.id, raw),
        eq(schema.alliances.ashedAllianceId, raw),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

export async function resolveSeasonKey(allianceId: string): Promise<string> {
  const envKey = process.env.DISCORD_ALLIANCE_SEASON_KEY?.trim();
  if (envKey) return envKey;

  const db = getDb();
  const [row] = await db
    .select({ currentSeasonKey: schema.alliances.currentSeasonKey })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.currentSeasonKey?.trim() || "1";
}

export async function writeDiscordBotAudit(input: {
  allianceId: string;
  discordUserId?: string | null;
  command: string;
  payload?: unknown;
  result?: unknown;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.discordBotAudit).values({
    id: nanoid(),
    allianceId: input.allianceId,
    discordUserId: input.discordUserId ?? null,
    command: input.command,
    payloadJson: input.payload ?? null,
    resultJson: input.result ?? null,
  });
}

export async function getDiscordBotPending(
  discordUserId: string,
): Promise<{ allianceId: string; pending: VrPendingState | LinkPendingState | null } | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordBotPending)
    .where(eq(schema.discordBotPending.discordUserId, discordUserId))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(schema.discordBotPending)
      .where(eq(schema.discordBotPending.discordUserId, discordUserId));
    return null;
  }
  const pending =
    parseVrPending(row.pendingJson) ?? parseLinkPending(row.pendingJson);
  return { allianceId: row.allianceId, pending };
}

export async function saveDiscordBotPending(
  allianceId: string,
  discordUserId: string,
  pending: VrPendingState | LinkPendingState | null,
): Promise<void> {
  const db = getDb();
  if (!pending) {
    await db
      .delete(schema.discordBotPending)
      .where(eq(schema.discordBotPending.discordUserId, discordUserId));
    return;
  }
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db
    .insert(schema.discordBotPending)
    .values({
      discordUserId,
      allianceId,
      pendingJson: pending,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.discordBotPending.discordUserId,
      set: { allianceId, pendingJson: pending, expiresAt, updatedAt: new Date() },
    });
}

export async function listDiscordLinksForUser(
  allianceId: string,
  discordUserId: string,
) {
  const db = getDb();
  return db
    .select()
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, allianceId),
        eq(schema.discordMemberLinks.discordUserId, discordUserId),
      ),
    );
}

export async function listDiscordLinksByAlliance(allianceId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.discordMemberLinks)
    .where(eq(schema.discordMemberLinks.allianceId, allianceId));
}

export async function getDiscordLinkById(linkId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordMemberLinks)
    .where(eq(schema.discordMemberLinks.id, linkId))
    .limit(1);
  return row ?? null;
}

export async function getLinkedMemberIds(allianceId: string): Promise<Set<string>> {
  const links = await listDiscordLinksByAlliance(allianceId);
  return new Set(links.map((l) => l.ashedMemberId));
}

export async function upsertDiscordMemberLink(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string | null;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  gameUid: string;
}) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .insert(schema.discordMemberLinks)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername ?? null,
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: input.memberDisplayName ?? null,
      gameUid: input.gameUid,
      linkedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.discordMemberLinks.allianceId,
        schema.discordMemberLinks.discordUserId,
      ],
      set: {
        ashedMemberId: input.ashedMemberId,
        memberDisplayName: input.memberDisplayName ?? null,
        gameUid: input.gameUid,
        discordUsername: input.discordUsername ?? null,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function getMemberSeasonHigh(
  allianceId: string,
  ashedMemberId: string,
  seasonKey: string,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({ highestBaseVr: schema.memberSeasonVr.highestBaseVr })
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.ashedMemberId, ashedMemberId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
      ),
    )
    .limit(1);
  return row?.highestBaseVr ?? null;
}

export async function countSeasonReporters(
  allianceId: string,
  seasonKey: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
      ),
    );
  return row?.count ?? 0;
}

export async function listSeasonVrRows(allianceId: string, seasonKey: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
      ),
    );
}

export async function upsertMemberSeasonVr(input: {
  allianceId: string;
  ashedMemberId: string;
  seasonKey: string;
  baseVr: number;
  discordUserId?: string | null;
  hqUserId?: string | null;
  flagReason?: string | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  const rows = await listSeasonVrRows(input.allianceId, input.seasonKey);
  const peerMax = peerMaxExcludingMember(rows, input.ashedMemberId);
  const flagReason =
    input.flagReason ??
    (input.baseVr >= peerMax + 750 || input.baseVr > 10250
      ? buildFlagReason(input.baseVr, peerMax)
      : null);

  await db
    .insert(schema.memberSeasonVr)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      seasonKey: input.seasonKey,
      highestBaseVr: input.baseVr,
      updatedByDiscordUserId: input.discordUserId ?? null,
      updatedByHqUserId: input.hqUserId ?? null,
      flaggedAt: flagReason ? now : null,
      flagReason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.memberSeasonVr.allianceId,
        schema.memberSeasonVr.ashedMemberId,
        schema.memberSeasonVr.seasonKey,
      ],
      set: {
        highestBaseVr: input.baseVr,
        updatedByDiscordUserId: input.discordUserId ?? null,
        updatedByHqUserId: input.hqUserId ?? null,
        updatedAt: now,
        flaggedAt: flagReason ? now : null,
        flagReason,
      },
    });
}

export async function listLeaderboardRows(allianceId: string, seasonKey: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
      ),
    )
    .orderBy(desc(schema.memberSeasonVr.highestBaseVr));
}

export async function listFlaggedSeasonVr(allianceId: string, seasonKey: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
        sql`${schema.memberSeasonVr.flaggedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(schema.memberSeasonVr.updatedAt));
}

export async function officerOverrideSeasonVr(input: {
  allianceId: string;
  ashedMemberId: string;
  seasonKey: string;
  baseVr: number;
  hqUserId: string;
  reason: string;
}): Promise<void> {
  await upsertMemberSeasonVr({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    seasonKey: input.seasonKey,
    baseVr: input.baseVr,
    hqUserId: input.hqUserId,
    flagReason: `officer_override:${input.reason}`,
  });
}

export async function purgeExpiredDiscordBotPending(): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(schema.discordBotPending)
    .where(lt(schema.discordBotPending.expiresAt, new Date()))
    .returning({ discordUserId: schema.discordBotPending.discordUserId });
  return deleted.length;
}

export async function listDiscordMemberLinks(allianceId: string) {
  return listDiscordLinksByAlliance(allianceId);
}

export async function deleteDiscordMemberLink(linkId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.discordMemberLinks)
    .where(eq(schema.discordMemberLinks.id, linkId));
}

export async function getAllianceById(allianceId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row ?? null;
}
