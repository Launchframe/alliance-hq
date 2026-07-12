import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import {
  denormalizeGameUidOnMember,
  openMemberAllianceTenure,
} from "@/lib/members/member-tenure.server";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { hasConflictingDiscordGameUidClaim } from "@/lib/member-link/link-claim-guards.shared";
import { parseAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { buildFlagReason, peerMaxExcludingMember } from "@/lib/vr/anomaly";
import { MAX_DISCORD_LINKS_PER_USER, type VrEventSource } from "@/lib/vr/constants";
import { coerceInstituteLevelFromBaseVr } from "@/lib/vr/institute-levels.shared";
import {
  evaluateGuildRegistrationAuth,
  type GuildRegistrationAuth,
  nativeOwnerClaimMemberId,
  officerProvenByMemberRanks,
  ownerProvenByMemberLink,
} from "@/lib/vr/discord-guild-registration";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import { getAllianceVrSandboxState } from "@/lib/vr/vr-sandbox.server";
import type { VrSeasonContext } from "@/lib/vr/vr-season-lock.shared";
import { resolveVrSeasonContextFromParts } from "@/lib/vr/vr-season-lock.shared";
import type { KillsPendingState } from "@/lib/kills/types";
import { parseStoredKillsPending } from "@/lib/kills/pending-state";
import type { ThpPendingState } from "@/lib/thp/types";
import { parseStoredThpPending } from "@/lib/thp/pending-state";
import type { LinkPendingState, VrPendingState } from "@/lib/vr/types";
import { parseStoredVrPending } from "@/lib/vr/pending-state";

const PENDING_TTL_MS = 30 * 60 * 1000;

export type DiscordBotPendingState =
  | VrPendingState
  | LinkPendingState
  | ThpPendingState
  | KillsPendingState;

function parseVrPending(value: unknown): VrPendingState | null {
  return parseStoredVrPending(value);
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
  if (r.kind === "link_roster_miss") {
    return {
      kind: "link_roster_miss",
      ...(typeof r.gameUid === "string" ? { gameUid: r.gameUid } : {}),
      ...(typeof r.gameUserName === "string"
        ? { gameUserName: r.gameUserName }
        : {}),
      ...(typeof r.reportedName === "string"
        ? { reportedName: r.reportedName }
        : {}),
    };
  }
  if (
    r.kind === "link_confirm_identity" &&
    typeof r.gameUid === "string" &&
    typeof r.gameUserName === "string"
  ) {
    return {
      kind: "link_confirm_identity",
      gameUid: r.gameUid,
      gameUserName: r.gameUserName,
      ...(typeof r.gameUserLevel === "number"
        ? { gameUserLevel: r.gameUserLevel }
        : {}),
      ...(typeof r.gameServerNumber === "number" ||
      r.gameServerNumber === null
        ? { gameServerNumber: r.gameServerNumber as number | null }
        : {}),
      ...(r.replaceAll === true ? { replaceAll: true } : {}),
    };
  }
  if (r.kind === "pick_alliance_by_name" && Array.isArray(r.candidates)) {
    return {
      kind: "pick_alliance_by_name",
      tag: String(r.tag),
      candidates: r.candidates as Array<{
        allianceId: string;
        name: string;
        tag: string;
      }>,
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

/**
 * Resolves which HQ alliance a Discord guild maps to.
 * Registered guilds use discord_guild_alliances only.
 * Legacy env fallback applies only when guildId matches DISCORD_GUILD_ID.
 */
export function resolveGuildAllianceIdWithLegacyFallback(input: {
  guildId: string | null | undefined;
  registeredAllianceId: string | null;
  legacyAllianceId: string | null;
  legacyGuildId: string | null | undefined;
}): string | null {
  const guildId = input.guildId?.trim() || null;
  const legacyGuildId = input.legacyGuildId?.trim() || null;
  const legacyAllianceId = input.legacyAllianceId?.trim() || null;

  if (guildId) {
    if (input.registeredAllianceId) {
      return input.registeredAllianceId;
    }
    if (legacyAllianceId && legacyGuildId && guildId === legacyGuildId) {
      return legacyAllianceId;
    }
    return null;
  }

  return legacyAllianceId;
}

export async function resolveVrSeasonContext(
  allianceId: string,
): Promise<VrSeasonContext> {
  const [sandbox, effective] = await Promise.all([
    getAllianceVrSandboxState(allianceId),
    getEffectiveSeasonForAlliance(allianceId),
  ]);

  return resolveVrSeasonContextFromParts({
    envSeasonKey: process.env.DISCORD_ALLIANCE_SEASON_KEY,
    effective: {
      seasonKey: effective.seasonKey,
      isPostSeason: effective.isPostSeason,
    },
    sandbox,
  });
}

/** Live season for leaderboards, officer review, and commanders — never sandbox. */
export async function resolveLiveVrSeasonContext(
  allianceId: string,
): Promise<VrSeasonContext> {
  return resolveVrSeasonContextFromParts({
    envSeasonKey: process.env.DISCORD_ALLIANCE_SEASON_KEY,
    effective: await getEffectiveSeasonForAlliance(allianceId),
    sandbox: { enabled: false, seasonKey: null },
  });
}

/** @deprecated Prefer resolveVrSeasonContext */
export async function resolveEffectiveSeasonForVr(
  allianceId: string,
): Promise<VrSeasonContext> {
  return resolveVrSeasonContext(allianceId);
}

export async function resolveSeasonKey(allianceId: string): Promise<string> {
  const { seasonKey } = await resolveLiveVrSeasonContext(allianceId);
  return seasonKey;
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

function parseThpPending(value: unknown): ThpPendingState | null {
  return parseStoredThpPending(value);
}

function parseKillsPending(value: unknown): KillsPendingState | null {
  return parseStoredKillsPending(value);
}

function parseDiscordBotPending(value: unknown): DiscordBotPendingState | null {
  return (
    parseThpPending(value) ??
    parseKillsPending(value) ??
    parseVrPending(value) ??
    parseLinkPending(value)
  );
}

export async function getDiscordBotPending(
  discordUserId: string,
): Promise<{ allianceId: string; pending: DiscordBotPendingState | null } | null> {
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
  const pending = parseDiscordBotPending(row.pendingJson);
  return { allianceId: row.allianceId, pending };
}

export async function saveDiscordBotPending(
  allianceId: string,
  discordUserId: string,
  pending: DiscordBotPendingState | null,
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
  const db = getDb();
  const [discordLinks, hqLinks] = await Promise.all([
    listDiscordLinksByAlliance(allianceId),
    db
      .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
      .from(schema.hqMemberLinks)
      .where(eq(schema.hqMemberLinks.allianceId, allianceId)),
  ]);
  const ids = new Set<string>();
  for (const link of discordLinks) {
    ids.add(link.ashedMemberId);
  }
  for (const link of hqLinks) {
    ids.add(link.ashedMemberId);
  }
  return ids;
}

export async function getDiscordLinkByAllianceAndMember(
  allianceId: string,
  ashedMemberId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, allianceId),
        eq(schema.discordMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type LinkDiscordMemberResult =
  | { ok: true; link: typeof schema.discordMemberLinks.$inferSelect; mode: "created" | "updated" | "replaced" }
  | { ok: false; reason: "cap_reached" | "member_linked_to_other_discord" };

async function isGameUidClaimedByOtherDiscordUser(input: {
  allianceId: string;
  discordUserId: string;
  ashedMemberId: string;
  gameUid: string;
}): Promise<boolean> {
  const gameUid = input.gameUid.trim();
  if (!gameUid) return false;

  const db = getDb();
  const [hqLink, hqClaims, discordClaims] = await Promise.all([
    getDiscordHqLink(input.discordUserId),
    db
      .select({
        hqUserId: schema.hqMemberLinks.hqUserId,
        ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      })
      .from(schema.hqMemberLinks)
      .where(
        and(
          eq(schema.hqMemberLinks.allianceId, input.allianceId),
          eq(schema.hqMemberLinks.gameUid, gameUid),
        ),
      ),
    db
      .select({
        discordUserId: schema.discordMemberLinks.discordUserId,
        ashedMemberId: schema.discordMemberLinks.ashedMemberId,
        hqUserId: schema.discordHqLinks.hqUserId,
      })
      .from(schema.discordMemberLinks)
      .leftJoin(
        schema.discordHqLinks,
        eq(
          schema.discordHqLinks.discordUserId,
          schema.discordMemberLinks.discordUserId,
        ),
      )
      .where(
        and(
          eq(schema.discordMemberLinks.allianceId, input.allianceId),
          eq(schema.discordMemberLinks.gameUid, gameUid),
        ),
      ),
  ]);

  return hasConflictingDiscordGameUidClaim({
    discordUserId: input.discordUserId,
    hqUserId: hqLink?.hqUserId ?? null,
    ashedMemberId: input.ashedMemberId,
    hqClaims,
    discordClaims,
  });
}

export async function linkDiscordMember(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string | null;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  gameUid: string;
  replaceAll?: boolean;
}): Promise<LinkDiscordMemberResult> {
  const db = getDb();
  const now = new Date();

  if (await isGameUidClaimedByOtherDiscordUser(input)) {
    return { ok: false, reason: "member_linked_to_other_discord" };
  }

  if (input.replaceAll) {
    await deleteDiscordMemberLinksForUser(input.allianceId, input.discordUserId);
  }

  const existingMemberLink = await getDiscordLinkByAllianceAndMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (
    existingMemberLink &&
    existingMemberLink.discordUserId !== input.discordUserId
  ) {
    return { ok: false, reason: "member_linked_to_other_discord" };
  }

  const userLinks = await listDiscordLinksForUser(
    input.allianceId,
    input.discordUserId,
  );
  const existingPair = userLinks.find(
    (row) => row.ashedMemberId === input.ashedMemberId,
  );

  if (existingPair) {
    const [row] = await db
      .update(schema.discordMemberLinks)
      .set({
        memberDisplayName: input.memberDisplayName ?? null,
        gameUid: input.gameUid,
        discordUsername: input.discordUsername ?? null,
        updatedAt: now,
      })
      .where(eq(schema.discordMemberLinks.id, existingPair.id))
      .returning();
    await denormalizeGameUidOnMember({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      gameUid: input.gameUid,
    });
    await openMemberAllianceTenure({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      gameUid: input.gameUid,
    });
    await syncCommanderIdentityFromMemberLink({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      gameUid: input.gameUid,
      memberDisplayName: input.memberDisplayName,
    });
    return { ok: true, link: row!, mode: input.replaceAll ? "replaced" : "updated" };
  }

  if (userLinks.length >= MAX_DISCORD_LINKS_PER_USER) {
    return { ok: false, reason: "cap_reached" };
  }

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
    .returning();

  await denormalizeGameUidOnMember({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid: input.gameUid,
  });
  await openMemberAllianceTenure({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid: input.gameUid,
    joinedAt: now,
  });
  await syncCommanderIdentityFromMemberLink({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid: input.gameUid,
    memberDisplayName: input.memberDisplayName,
    joinedAt: now,
  });

  return {
    ok: true,
    link: row!,
    mode: input.replaceAll ? "replaced" : "created",
  };
}

/** @deprecated Use linkDiscordMember — kept for admin paths that expect upsert semantics. */
export async function upsertDiscordMemberLink(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string | null;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  gameUid: string;
}) {
  const result = await linkDiscordMember(input);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.link;
}

export async function deleteDiscordMemberLinksForUser(
  allianceId: string,
  discordUserId: string,
  ashedMemberId?: string,
): Promise<number> {
  const db = getDb();
  const conditions = [
    eq(schema.discordMemberLinks.allianceId, allianceId),
    eq(schema.discordMemberLinks.discordUserId, discordUserId),
  ];
  if (ashedMemberId) {
    conditions.push(eq(schema.discordMemberLinks.ashedMemberId, ashedMemberId));
  }
  const deleted = await db
    .delete(schema.discordMemberLinks)
    .where(and(...conditions))
    .returning({ id: schema.discordMemberLinks.id });
  return deleted.length;
}

export type AllianceSeasonVrLeaderboardRow = {
  id: string;
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  seasonKey: string;
  highestBaseVr: number;
  instituteLevel: number | null;
  flaggedAt: Date | null;
  flagReason: string | null;
  updatedByDiscordUserId: string | null;
  updatedByHqUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function resolveCommanderIdForMember(
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
  const commander = await getCommanderByAshedMemberId(ashedMemberId, allianceId);
  return commander?.commanderId ?? null;
}

export async function getCommanderSeasonHigh(
  commanderId: string,
  seasonKey: string,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({ highestBaseVr: schema.commanderSeasonVr.highestBaseVr })
    .from(schema.commanderSeasonVr)
    .where(
      and(
        eq(schema.commanderSeasonVr.commanderId, commanderId),
        eq(schema.commanderSeasonVr.seasonKey, seasonKey),
      ),
    )
    .limit(1);
  return row?.highestBaseVr ?? null;
}

export async function getCommanderSeasonVrRow(
  commanderId: string,
  seasonKey: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.commanderSeasonVr)
    .where(
      and(
        eq(schema.commanderSeasonVr.commanderId, commanderId),
        eq(schema.commanderSeasonVr.seasonKey, seasonKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getLegacyMemberSeasonHigh(
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

export async function getMemberSeasonHigh(
  allianceId: string,
  ashedMemberId: string,
  seasonKey: string,
): Promise<number | null> {
  const commanderId = await resolveCommanderIdForMember(
    allianceId,
    ashedMemberId,
  );
  if (commanderId) {
    const commanderHigh = await getCommanderSeasonHigh(commanderId, seasonKey);
    if (commanderHigh != null) return commanderHigh;
  }
  return getLegacyMemberSeasonHigh(allianceId, ashedMemberId, seasonKey);
}

export async function listAllianceSeasonVrForLeaderboard(
  allianceId: string,
  seasonKey: string,
): Promise<AllianceSeasonVrLeaderboardRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.commanderSeasonVr.id,
      commanderId: schema.commanderSeasonVr.commanderId,
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
      seasonKey: schema.commanderSeasonVr.seasonKey,
      highestBaseVr: schema.commanderSeasonVr.highestBaseVr,
      instituteLevel: schema.commanderSeasonVr.instituteLevel,
      flaggedAt: schema.commanderSeasonVr.flaggedAt,
      flagReason: schema.commanderSeasonVr.flagReason,
      updatedByDiscordUserId: schema.commanderSeasonVr.updatedByDiscordUserId,
      updatedByHqUserId: schema.commanderSeasonVr.updatedByHqUserId,
      createdAt: schema.commanderSeasonVr.createdAt,
      updatedAt: schema.commanderSeasonVr.updatedAt,
    })
    .from(schema.commanderSeasonVr)
    .innerJoin(
      schema.commanderAllianceMemberships,
      and(
        eq(
          schema.commanderAllianceMemberships.commanderId,
          schema.commanderSeasonVr.commanderId,
        ),
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    )
    .where(eq(schema.commanderSeasonVr.seasonKey, seasonKey))
    .orderBy(desc(schema.commanderSeasonVr.highestBaseVr));

  return rows.map((row) => ({
    ...row,
    allianceId,
  }));
}

export async function countSeasonReporters(
  allianceId: string,
  seasonKey: string,
): Promise<number> {
  const allianceRows = await listAllianceSeasonVrForLeaderboard(
    allianceId,
    seasonKey,
  );
  if (allianceRows.length > 0) {
    return allianceRows.length;
  }
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
  const allianceRows = await listAllianceSeasonVrForLeaderboard(
    allianceId,
    seasonKey,
  );
  if (allianceRows.length > 0) {
    return allianceRows.map((row) => ({
      id: row.id,
      allianceId: row.allianceId,
      ashedMemberId: row.ashedMemberId,
      seasonKey: row.seasonKey,
      highestBaseVr: row.highestBaseVr,
      instituteLevel: row.instituteLevel,
      flaggedAt: row.flaggedAt,
      flagReason: row.flagReason,
      updatedByDiscordUserId: row.updatedByDiscordUserId,
      updatedByHqUserId: row.updatedByHqUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
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

async function writeLegacyMemberSeasonVr(input: {
  allianceId: string;
  ashedMemberId: string;
  seasonKey: string;
  baseVr: number;
  instituteLevel: number | null;
  discordUserId?: string | null;
  hqUserId?: string | null;
  flagReason: string | null;
  previousBaseVr: number | null;
  eventSource?: VrEventSource;
  now: Date;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.memberSeasonVr)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      seasonKey: input.seasonKey,
      highestBaseVr: input.baseVr,
      instituteLevel: input.instituteLevel,
      updatedByDiscordUserId: input.discordUserId ?? null,
      updatedByHqUserId: input.hqUserId ?? null,
      flaggedAt: input.flagReason ? input.now : null,
      flagReason: input.flagReason,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        schema.memberSeasonVr.allianceId,
        schema.memberSeasonVr.ashedMemberId,
        schema.memberSeasonVr.seasonKey,
      ],
      set: {
        highestBaseVr: input.baseVr,
        instituteLevel: input.instituteLevel,
        updatedByDiscordUserId: input.discordUserId ?? null,
        updatedByHqUserId: input.hqUserId ?? null,
        updatedAt: input.now,
        flaggedAt: input.flagReason ? input.now : null,
        flagReason: input.flagReason,
      },
    });

  if (input.eventSource && input.previousBaseVr !== input.baseVr) {
    await db.insert(schema.memberSeasonVrEvents).values({
      id: nanoid(),
      allianceId: input.allianceId,
      seasonKey: input.seasonKey,
      ashedMemberId: input.ashedMemberId,
      baseVr: input.baseVr,
      instituteLevel: input.instituteLevel,
      previousBaseVr: input.previousBaseVr,
      source: input.eventSource,
      reportedByHqUserId: input.hqUserId ?? null,
      reportedByDiscordUserId: input.discordUserId ?? null,
      createdAt: input.now,
    });
  }
}

export async function upsertCommanderSeasonVr(input: {
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  seasonKey: string;
  baseVr: number;
  instituteLevel?: number | null;
  discordUserId?: string | null;
  hqUserId?: string | null;
  flagReason?: string | null;
  eventSource?: VrEventSource;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  const previousBaseVr =
    (await getCommanderSeasonHigh(input.commanderId, input.seasonKey)) ??
    (await getLegacyMemberSeasonHigh(
      input.allianceId,
      input.ashedMemberId,
      input.seasonKey,
    ));
  const instituteLevel =
    input.instituteLevel ??
    coerceInstituteLevelFromBaseVr(input.seasonKey, input.baseVr);
  const rows = await listSeasonVrRows(input.allianceId, input.seasonKey);
  const peerMax = peerMaxExcludingMember(rows, input.ashedMemberId);
  const flagReason =
    input.flagReason ??
    (input.baseVr >= peerMax + 750 || input.baseVr > 10250
      ? buildFlagReason(input.baseVr, peerMax)
      : null);

  await db
    .insert(schema.commanderSeasonVr)
    .values({
      id: nanoid(),
      commanderId: input.commanderId,
      seasonKey: input.seasonKey,
      highestBaseVr: input.baseVr,
      instituteLevel,
      updatedByDiscordUserId: input.discordUserId ?? null,
      updatedByHqUserId: input.hqUserId ?? null,
      flaggedAt: flagReason ? now : null,
      flagReason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.commanderSeasonVr.commanderId,
        schema.commanderSeasonVr.seasonKey,
      ],
      set: {
        highestBaseVr: input.baseVr,
        instituteLevel,
        updatedByDiscordUserId: input.discordUserId ?? null,
        updatedByHqUserId: input.hqUserId ?? null,
        updatedAt: now,
        flaggedAt: flagReason ? now : null,
        flagReason,
      },
    });

  if (input.eventSource && previousBaseVr !== input.baseVr) {
    await db.insert(schema.commanderSeasonVrEvents).values({
      id: nanoid(),
      commanderId: input.commanderId,
      seasonKey: input.seasonKey,
      baseVr: input.baseVr,
      instituteLevel,
      previousBaseVr,
      source: input.eventSource,
      allianceId: input.allianceId,
      reportedByHqUserId: input.hqUserId ?? null,
      reportedByDiscordUserId: input.discordUserId ?? null,
      createdAt: now,
    });
  }

  // Dual-write legacy roster-keyed tables for rollback / orphan coverage.
  await writeLegacyMemberSeasonVr({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    seasonKey: input.seasonKey,
    baseVr: input.baseVr,
    instituteLevel,
    discordUserId: input.discordUserId,
    hqUserId: input.hqUserId,
    flagReason,
    previousBaseVr,
    eventSource: input.eventSource,
    now,
  });
}

export async function upsertMemberSeasonVr(input: {
  allianceId: string;
  ashedMemberId: string;
  seasonKey: string;
  baseVr: number;
  instituteLevel?: number | null;
  discordUserId?: string | null;
  hqUserId?: string | null;
  flagReason?: string | null;
  eventSource?: VrEventSource;
  commanderId?: string | null;
}): Promise<void> {
  const commanderId =
    input.commanderId ??
    (await resolveCommanderIdForMember(input.allianceId, input.ashedMemberId));
  if (commanderId) {
    await upsertCommanderSeasonVr({
      ...input,
      commanderId,
    });
    return;
  }

  const now = new Date();
  const previousBaseVr = await getLegacyMemberSeasonHigh(
    input.allianceId,
    input.ashedMemberId,
    input.seasonKey,
  );
  const instituteLevel =
    input.instituteLevel ??
    coerceInstituteLevelFromBaseVr(input.seasonKey, input.baseVr);
  const rows = await listSeasonVrRows(input.allianceId, input.seasonKey);
  const peerMax = peerMaxExcludingMember(rows, input.ashedMemberId);
  const flagReason =
    input.flagReason ??
    (input.baseVr >= peerMax + 750 || input.baseVr > 10250
      ? buildFlagReason(input.baseVr, peerMax)
      : null);

  await writeLegacyMemberSeasonVr({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    seasonKey: input.seasonKey,
    baseVr: input.baseVr,
    instituteLevel,
    discordUserId: input.discordUserId,
    hqUserId: input.hqUserId,
    flagReason,
    previousBaseVr,
    eventSource: input.eventSource,
    now,
  });
}

export async function listCommanderSeasonVrEvents(
  commanderId: string,
  seasonKey: string,
) {
  const db = getDb();
  return db
    .select()
    .from(schema.commanderSeasonVrEvents)
    .where(
      and(
        eq(schema.commanderSeasonVrEvents.commanderId, commanderId),
        eq(schema.commanderSeasonVrEvents.seasonKey, seasonKey),
      ),
    )
    .orderBy(asc(schema.commanderSeasonVrEvents.createdAt));
}

async function recomputeCommanderSeasonSummaryFromEvents(
  commanderId: string,
  seasonKey: string,
  allianceId: string,
  ashedMemberId: string | null,
  hqUserId: string | null,
): Promise<void> {
  const db = getDb();
  const events = await listCommanderSeasonVrEvents(commanderId, seasonKey);
  if (events.length === 0) {
    await db
      .delete(schema.commanderSeasonVr)
      .where(
        and(
          eq(schema.commanderSeasonVr.commanderId, commanderId),
          eq(schema.commanderSeasonVr.seasonKey, seasonKey),
        ),
      );
    if (ashedMemberId) {
      await db
        .delete(schema.memberSeasonVr)
        .where(
          and(
            eq(schema.memberSeasonVr.allianceId, allianceId),
            eq(schema.memberSeasonVr.ashedMemberId, ashedMemberId),
            eq(schema.memberSeasonVr.seasonKey, seasonKey),
          ),
        );
    }
    return;
  }

  const best = events.reduce((a, b) =>
    b.baseVr > a.baseVr ||
    (b.baseVr === a.baseVr && b.createdAt.getTime() > a.createdAt.getTime())
      ? b
      : a,
  );
  const instituteLevel =
    best.instituteLevel ??
    coerceInstituteLevelFromBaseVr(seasonKey, best.baseVr);
  const now = new Date();

  await db
    .insert(schema.commanderSeasonVr)
    .values({
      id: nanoid(),
      commanderId,
      seasonKey,
      highestBaseVr: best.baseVr,
      instituteLevel,
      flaggedAt: null,
      flagReason: null,
      updatedByDiscordUserId: null,
      updatedByHqUserId: hqUserId,
      createdAt: events[0]!.createdAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.commanderSeasonVr.commanderId,
        schema.commanderSeasonVr.seasonKey,
      ],
      set: {
        highestBaseVr: best.baseVr,
        instituteLevel,
        flaggedAt: null,
        flagReason: null,
        updatedByHqUserId: hqUserId,
        updatedAt: now,
      },
    });

  if (ashedMemberId) {
    await writeLegacyMemberSeasonVr({
      allianceId,
      ashedMemberId,
      seasonKey,
      baseVr: best.baseVr,
      instituteLevel,
      hqUserId,
      flagReason: null,
      previousBaseVr: best.baseVr,
      now,
    });
  }
}

export async function updateCommanderSeasonVrEvent(input: {
  eventId: string;
  allianceId: string;
  instituteLevel: number;
  baseVr: number;
  hqUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const [event] = await db
    .select()
    .from(schema.commanderSeasonVrEvents)
    .where(eq(schema.commanderSeasonVrEvents.id, input.eventId))
    .limit(1);
  if (!event) return { ok: false, error: "Event not found." };

  const membership = await db
    .select({
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
    })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(
          schema.commanderAllianceMemberships.commanderId,
          event.commanderId,
        ),
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    )
    .limit(1);
  if (!membership[0]) return { ok: false, error: "Event not found." };

  await db
    .update(schema.commanderSeasonVrEvents)
    .set({
      baseVr: input.baseVr,
      instituteLevel: input.instituteLevel,
    })
    .where(eq(schema.commanderSeasonVrEvents.id, input.eventId));

  // Dual-write legacy event row when ids match (backfill preserved ids).
  await db
    .update(schema.memberSeasonVrEvents)
    .set({
      baseVr: input.baseVr,
      instituteLevel: input.instituteLevel,
    })
    .where(eq(schema.memberSeasonVrEvents.id, input.eventId));

  await recomputeCommanderSeasonSummaryFromEvents(
    event.commanderId,
    event.seasonKey,
    input.allianceId,
    membership[0]?.ashedMemberId ?? null,
    input.hqUserId,
  );
  return { ok: true };
}

export async function deleteCommanderSeasonVrEvent(input: {
  eventId: string;
  allianceId: string;
  hqUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const [event] = await db
    .select()
    .from(schema.commanderSeasonVrEvents)
    .where(eq(schema.commanderSeasonVrEvents.id, input.eventId))
    .limit(1);
  if (!event) return { ok: false, error: "Event not found." };

  const membership = await db
    .select({
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
    })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(
          schema.commanderAllianceMemberships.commanderId,
          event.commanderId,
        ),
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    )
    .limit(1);
  if (!membership[0]) return { ok: false, error: "Event not found." };

  await db
    .delete(schema.commanderSeasonVrEvents)
    .where(eq(schema.commanderSeasonVrEvents.id, input.eventId));
  await db
    .delete(schema.memberSeasonVrEvents)
    .where(eq(schema.memberSeasonVrEvents.id, input.eventId));

  await recomputeCommanderSeasonSummaryFromEvents(
    event.commanderId,
    event.seasonKey,
    input.allianceId,
    membership[0]?.ashedMemberId ?? null,
    input.hqUserId,
  );
  return { ok: true };
}

export async function listCommanderSeasonVrEventsBulk(
  commanderIds: string[],
  seasonKey: string,
) {
  if (commanderIds.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(schema.commanderSeasonVrEvents)
    .where(
      and(
        inArray(schema.commanderSeasonVrEvents.commanderId, commanderIds),
        eq(schema.commanderSeasonVrEvents.seasonKey, seasonKey),
      ),
    )
    .orderBy(asc(schema.commanderSeasonVrEvents.createdAt));
}

export async function listMemberSeasonVrEvents(
  allianceId: string,
  seasonKey: string,
  ashedMemberId: string,
) {
  const commanderId = await resolveCommanderIdForMember(
    allianceId,
    ashedMemberId,
  );
  if (commanderId) {
    const commanderEvents = await listCommanderSeasonVrEvents(
      commanderId,
      seasonKey,
    );
    if (commanderEvents.length > 0) {
      return commanderEvents.map((event) => ({
        id: event.id,
        allianceId: event.allianceId ?? allianceId,
        seasonKey: event.seasonKey,
        ashedMemberId,
        baseVr: event.baseVr,
        instituteLevel: event.instituteLevel,
        previousBaseVr: event.previousBaseVr,
        source: event.source,
        reportedByHqUserId: event.reportedByHqUserId,
        reportedByDiscordUserId: event.reportedByDiscordUserId,
        createdAt: event.createdAt,
      }));
    }
  }

  const db = getDb();
  return db
    .select()
    .from(schema.memberSeasonVrEvents)
    .where(
      and(
        eq(schema.memberSeasonVrEvents.allianceId, allianceId),
        eq(schema.memberSeasonVrEvents.seasonKey, seasonKey),
        eq(schema.memberSeasonVrEvents.ashedMemberId, ashedMemberId),
      ),
    )
    .orderBy(asc(schema.memberSeasonVrEvents.createdAt));
}

export async function getHqVrPending(
  allianceId: string,
  hqUserId: string,
): Promise<VrPendingState | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqVrPending)
    .where(
      and(
        eq(schema.hqVrPending.allianceId, allianceId),
        eq(schema.hqVrPending.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(schema.hqVrPending)
      .where(
        and(
          eq(schema.hqVrPending.allianceId, allianceId),
          eq(schema.hqVrPending.hqUserId, hqUserId),
        ),
      );
    return null;
  }
  return parseVrPending(row.pendingJson);
}

export async function saveHqVrPending(
  allianceId: string,
  hqUserId: string,
  pending: VrPendingState | null,
): Promise<void> {
  const db = getDb();
  if (!pending) {
    await db
      .delete(schema.hqVrPending)
      .where(
        and(
          eq(schema.hqVrPending.allianceId, allianceId),
          eq(schema.hqVrPending.hqUserId, hqUserId),
        ),
      );
    return;
  }
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db
    .insert(schema.hqVrPending)
    .values({
      allianceId,
      hqUserId,
      pendingJson: pending,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.hqVrPending.allianceId, schema.hqVrPending.hqUserId],
      set: { pendingJson: pending, expiresAt, updatedAt: new Date() },
    });
}

export async function purgeExpiredHqVrPending(): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(schema.hqVrPending)
    .where(lt(schema.hqVrPending.expiresAt, new Date()))
    .returning({ hqUserId: schema.hqVrPending.hqUserId });
  return deleted.length;
}

export async function listLeaderboardRows(allianceId: string, seasonKey: string) {
  const allianceRows = await listAllianceSeasonVrForLeaderboard(
    allianceId,
    seasonKey,
  );
  if (allianceRows.length > 0) {
    return allianceRows.map((row) => ({
      id: row.id,
      allianceId: row.allianceId,
      ashedMemberId: row.ashedMemberId,
      seasonKey: row.seasonKey,
      highestBaseVr: row.highestBaseVr,
      instituteLevel: row.instituteLevel,
      flaggedAt: row.flaggedAt,
      flagReason: row.flagReason,
      updatedByDiscordUserId: row.updatedByDiscordUserId,
      updatedByHqUserId: row.updatedByHqUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
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

export async function listWeeklyPassActiveByAlliance(
  allianceId: string,
): Promise<Map<string, boolean>> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
      weeklyPassActive: schema.commanders.weeklyPassActive,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanderAllianceMemberships.commanderId, schema.commanders.id),
    )
    .where(eq(schema.commanderAllianceMemberships.allianceId, allianceId));

  return new Map(
    rows.map((row) => [row.ashedMemberId, row.weeklyPassActive]),
  );
}

export async function getCommanderByAshedMemberId(
  ashedMemberId: string,
  allianceId: string,
): Promise<{ commanderId: string; weeklyPassActive: boolean } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      commanderId: schema.commanderAllianceMemberships.commanderId,
      weeklyPassActive: schema.commanders.weeklyPassActive,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanderAllianceMemberships.commanderId, schema.commanders.id),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function setWeeklyPass(input: {
  commanderId: string;
  active: boolean;
  source: "self" | "officer";
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.commanders)
    .set({
      weeklyPassActive: input.active,
      weeklyPassSource: input.source,
      weeklyPassUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, input.commanderId));
}

export async function listFlaggedSeasonVr(allianceId: string, seasonKey: string) {
  const allianceRows = await listAllianceSeasonVrForLeaderboard(
    allianceId,
    seasonKey,
  );
  const flagged = allianceRows
    .filter((row) => row.flaggedAt != null)
    .sort(
      (a, b) =>
        (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    )
    .map((row) => ({
      id: row.id,
      allianceId: row.allianceId,
      ashedMemberId: row.ashedMemberId,
      seasonKey: row.seasonKey,
      highestBaseVr: row.highestBaseVr,
      instituteLevel: row.instituteLevel,
      flaggedAt: row.flaggedAt,
      flagReason: row.flagReason,
      updatedByDiscordUserId: row.updatedByDiscordUserId,
      updatedByHqUserId: row.updatedByHqUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  if (flagged.length > 0 || allianceRows.length > 0) {
    return flagged;
  }
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
  instituteLevel?: number | null;
  hqUserId: string;
  reason: string;
}): Promise<void> {
  await upsertMemberSeasonVr({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    seasonKey: input.seasonKey,
    baseVr: input.baseVr,
    instituteLevel: input.instituteLevel,
    hqUserId: input.hqUserId,
    flagReason: `officer_override:${input.reason}`,
    eventSource: "officer_override",
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

export async function resolveAllianceForGuild(
  guildId: string | null | undefined,
): Promise<string | null> {
  const registered = guildId ? await getGuildAllianceId(guildId) : null;
  const legacyAllianceId = await resolveDiscordAllianceId();
  return resolveGuildAllianceIdWithLegacyFallback({
    guildId,
    registeredAllianceId: registered,
    legacyAllianceId,
    legacyGuildId: process.env.DISCORD_GUILD_ID,
  });
}

export async function getGuildAllianceId(guildId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ allianceId: schema.discordGuildAlliances.allianceId })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.guildId, guildId))
    .limit(1);
  return row?.allianceId ?? null;
}

/** Owner setup phase: credentials saved via HQ authorize, guild not linked yet. */
export async function resolveOwnerSetupAllianceId(
  guildId: string,
  discordUserId: string,
): Promise<string | null> {
  const registered = await getGuildAllianceId(guildId);
  if (registered) return null;

  const db = getDb();
  const [cred] = await db
    .select({ allianceId: schema.allianceAshedCredentials.allianceId })
    .from(schema.allianceAshedCredentials)
    .where(
      eq(schema.allianceAshedCredentials.registeredByDiscordUserId, discordUserId),
    )
    .orderBy(desc(schema.allianceAshedCredentials.updatedAt))
    .limit(1);
  return cred?.allianceId ?? null;
}

export async function getDiscordHqLink(discordUserId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.discordUserId, discordUserId))
    .limit(1);
  return row ?? null;
}

export async function getDiscordHqLinkByHqUserId(hqUserId: string) {
  const trimmed = hqUserId.trim();
  if (!trimmed) {
    return null;
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.hqUserId, trimmed))
    .limit(1);
  return row ?? null;
}

export async function deleteDiscordHqLinkForHqUser(hqUserId: string): Promise<boolean> {
  const trimmed = hqUserId.trim();
  if (!trimmed) {
    return false;
  }

  const db = getDb();
  const deleted = await db
    .delete(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.hqUserId, trimmed))
    .returning({ discordUserId: schema.discordHqLinks.discordUserId });
  return deleted.length > 0;
}

export async function upsertDiscordHqLink(input: {
  discordUserId: string;
  hqUserId: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(schema.discordHqLinks)
    .values({
      discordUserId: input.discordUserId,
      hqUserId: input.hqUserId,
      linkedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.discordHqLinks.discordUserId,
      set: { hqUserId: input.hqUserId, linkedAt: now },
    });
}

export async function getHqUserById(hqUserId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return row ?? null;
}

export async function callerIsPlatformMaintainerViaDiscord(
  discordUserId: string,
): Promise<boolean> {
  const link = await getDiscordHqLink(discordUserId);
  if (!link) return false;
  const user = await getHqUserById(link.hqUserId);
  return Boolean(user?.isPlatformMaintainer);
}

export async function userRegisteredAllianceCredentials(
  discordUserId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ allianceId: schema.allianceAshedCredentials.allianceId })
    .from(schema.allianceAshedCredentials)
    .where(
      eq(schema.allianceAshedCredentials.registeredByDiscordUserId, discordUserId),
    )
    .limit(1);
  return row != null;
}

export async function isCredentialRegistrantForAlliance(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  const cred = await getAllianceAshedCredential(input.allianceId);
  return cred?.registeredByDiscordUserId === input.discordUserId;
}

export async function allianceHasRegistrationCredentials(
  allianceId: string,
): Promise<boolean> {
  if (await isNativeAlliance(allianceId)) return true;
  return (await getAllianceAshedCredential(allianceId)) != null;
}

export async function countRegisteredGuildsForAlliance(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.allianceId, allianceId));
  return Number(row?.value ?? 0);
}

/** Mirror web commanders onto Discord when HQ is linked (avoids circular import). */
async function ensureDiscordMemberLinksFromHqLazy(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<void> {
  const { ensureDiscordMemberLinksFromHq } = await import(
    "@/lib/member-link/inherit-hq-to-discord.server"
  );
  await ensureDiscordMemberLinksFromHq(input);
}

/** R4+ officer proof via linked commander rank on the local roster (same gate as VR reports). */
export async function callerIsAllianceOfficerViaMemberLink(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  await ensureDiscordMemberLinksFromHqLazy(input);
  const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
  if (links.length === 0) {
    return false;
  }

  const members = await loadAllianceMembersForBot(input.allianceId);
  const ranks = links
    .map((link) => members.find((member) => member.id === link.ashedMemberId))
    .filter((member): member is NonNullable<typeof member> => member != null)
    .map((member) => parseAshedMemberAllianceRank(member).rank ?? 0);

  return officerProvenByMemberRanks(ranks);
}

export async function callerCanRegisterGuildAlliance(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<GuildRegistrationAuth> {
  const [hqLink, alliance, hasCredentials] = await Promise.all([
    getDiscordHqLink(input.discordUserId),
    getAllianceById(input.allianceId),
    allianceHasRegistrationCredentials(input.allianceId),
  ]);

  const linkedHqUser = hqLink ? await getHqUserById(hqLink.hqUserId) : null;
  const isPlatformMaintainer = Boolean(linkedHqUser?.isPlatformMaintainer);
  const isCredentialRegistrant = await isCredentialRegistrantForAlliance(input);
  const isOwnerViaMemberLink = await callerOwnsAllianceViaMemberLink(input);
  const isOfficerViaMemberLink =
    !isOwnerViaMemberLink &&
    (await callerIsAllianceOfficerViaMemberLink(input));

  return evaluateGuildRegistrationAuth({
    hasHqLink: hqLink != null,
    isPlatformMaintainer,
    isCredentialRegistrant,
    isOwnerViaMemberLink,
    isOfficerViaMemberLink,
    ownerAshedUserId: alliance?.ownerAshedUserId ?? null,
    linkedHqAshedUserId: linkedHqUser?.ashedUserId ?? null,
    hasCredentials,
  });
}

export async function upsertGuildAlliance(
  guildId: string,
  allianceId: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.discordGuildAlliances)
    .values({
      guildId,
      allianceId,
      registeredAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.discordGuildAlliances.guildId,
      set: { allianceId, registeredAt: new Date() },
    });
}

export async function setGuildVrReportChannel(
  guildId: string,
  channelId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.discordGuildAlliances)
    .set({ vrReportChannelId: channelId })
    .where(eq(schema.discordGuildAlliances.guildId, guildId));
}

export async function getGuildVrReportChannel(
  guildId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ channelId: schema.discordGuildAlliances.vrReportChannelId })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.guildId, guildId))
    .limit(1);
  return row?.channelId?.trim() || null;
}

export async function listRegisteredGuildsWithReportChannel(): Promise<
  Array<{ guildId: string; allianceId: string; channelId: string }>
> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      allianceId: schema.discordGuildAlliances.allianceId,
      channelId: schema.discordGuildAlliances.vrReportChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(sql`${schema.discordGuildAlliances.vrReportChannelId} is not null`);

  return rows
    .filter((row): row is typeof row & { channelId: string } =>
      Boolean(row.channelId?.trim()),
    )
    .map((row) => ({
      guildId: row.guildId,
      allianceId: row.allianceId,
      channelId: row.channelId.trim(),
    }));
}

export async function setGuildTrainChannel(
  guildId: string,
  channelId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.discordGuildAlliances)
    .set({ trainChannelId: channelId })
    .where(eq(schema.discordGuildAlliances.guildId, guildId));
}

export async function getGuildTrainChannel(
  guildId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ channelId: schema.discordGuildAlliances.trainChannelId })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.guildId, guildId))
    .limit(1);
  return row?.channelId?.trim() || null;
}

export async function listRegisteredGuildsWithTrainChannel(): Promise<
  Array<{ guildId: string; allianceId: string; channelId: string }>
> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      allianceId: schema.discordGuildAlliances.allianceId,
      channelId: schema.discordGuildAlliances.trainChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(sql`${schema.discordGuildAlliances.trainChannelId} is not null`);

  return rows
    .filter((row): row is typeof row & { channelId: string } =>
      Boolean(row.channelId?.trim()),
    )
    .map((row) => ({
      guildId: row.guildId,
      allianceId: row.allianceId,
      channelId: row.channelId.trim(),
    }));
}

export async function getAllianceTrainDiscordAnnouncementsEnabled(
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({
      enabled: schema.alliances.trainDiscordAnnouncementsEnabled,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.enabled === 1;
}

export async function setAllianceTrainDiscordAnnouncementsEnabled(
  allianceId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      trainDiscordAnnouncementsEnabled: enabled ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));
}

export async function listAllianceDiscordGuildTrainSetup(
  allianceId: string,
): Promise<
  Array<{
    guildId: string;
    hasTrainChannel: boolean;
    discordOpenUrl: string;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      trainChannelId: schema.discordGuildAlliances.trainChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.allianceId, allianceId));

  return rows.map((row) => ({
    guildId: row.guildId,
    hasTrainChannel: Boolean(row.trainChannelId?.trim()),
    discordOpenUrl: `https://discord.com/channels/${row.guildId}`,
  }));
}

export async function listGuildTrainChannelsForAlliance(
  allianceId: string,
): Promise<Array<{ guildId: string; channelId: string }>> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      channelId: schema.discordGuildAlliances.trainChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.allianceId, allianceId));

  return rows
    .filter((row): row is typeof row & { channelId: string } =>
      Boolean(row.channelId?.trim()),
    )
    .map((row) => ({
      guildId: row.guildId,
      channelId: row.channelId.trim(),
    }));
}

export async function getDiscordUserLocale(
  discordUserId: string,
): Promise<"en-US" | "pt-BR" | null> {
  const db = getDb();
  const [row] = await db
    .select({ locale: schema.discordUserPrefs.locale })
    .from(schema.discordUserPrefs)
    .where(eq(schema.discordUserPrefs.discordUserId, discordUserId))
    .limit(1);
  if (!row?.locale) return null;
  return row.locale === "pt-BR" ? "pt-BR" : "en-US";
}

export async function upsertDiscordUserLocale(
  discordUserId: string,
  locale: "en-US" | "pt-BR",
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.discordUserPrefs)
    .values({
      discordUserId,
      locale,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.discordUserPrefs.discordUserId,
      set: { locale, updatedAt: new Date() },
    });
}

export async function getAllianceAshedCredential(allianceId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.allianceAshedCredentials)
    .where(eq(schema.allianceAshedCredentials.allianceId, allianceId))
    .limit(1);
  return row ?? null;
}

export async function upsertAllianceAshedCredential(input: {
  allianceId: string;
  appId: string;
  originUrl: string;
  encryptedToken: string;
  tokenExpiresAt?: Date | null;
  registeredByDiscordUserId?: string | null;
  registeredByHqUserId?: string | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(schema.allianceAshedCredentials)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      appId: input.appId,
      originUrl: input.originUrl,
      encryptedToken: input.encryptedToken,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      registeredByDiscordUserId: input.registeredByDiscordUserId ?? null,
      registeredByHqUserId: input.registeredByHqUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.allianceAshedCredentials.allianceId,
      set: {
        appId: input.appId,
        originUrl: input.originUrl,
        encryptedToken: input.encryptedToken,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        registeredByDiscordUserId: input.registeredByDiscordUserId ?? null,
        registeredByHqUserId: input.registeredByHqUserId ?? null,
        updatedAt: now,
      },
    });
}

export async function updateAllianceSeasonKey(
  allianceId: string,
  seasonKey: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({ currentSeasonKey: seasonKey, updatedAt: new Date() })
    .where(eq(schema.alliances.id, allianceId));
}

export async function listDiscordLinksForUserAnyAlliance(discordUserId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.discordMemberLinks)
    .where(eq(schema.discordMemberLinks.discordUserId, discordUserId));
}

export async function callerIsAllianceOwner(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  const alliance = await getAllianceById(input.allianceId);
  if (!alliance) return false;

  await ensureDiscordMemberLinksFromHqLazy(input);
  const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);

  return ownerProvenByMemberLink({
    allianceExists: true,
    ownerMemberExternalId: alliance.ownerMemberExternalId,
    linkedMemberIds: links.map((link) => link.ashedMemberId),
  });
}

/** Ownership proof for guild registration that does NOT require Ashed credentials.
 *  A Discord member link matching ownerMemberExternalId is enough
 *  (in-game name + UID is the auth, Ashed is optional). */
export async function callerOwnsAllianceViaMemberLink(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  await ensureDiscordMemberLinksFromHqLazy(input);
  const [alliance, links] = await Promise.all([
    getAllianceById(input.allianceId),
    listDiscordLinksForUser(input.allianceId, input.discordUserId),
  ]);
  return ownerProvenByMemberLink({
    allianceExists: alliance != null,
    ownerMemberExternalId: alliance?.ownerMemberExternalId ?? null,
    linkedMemberIds: links.map((link) => link.ashedMemberId),
  });
}

/** Claim native-alliance ownership from a successful Discord member link when
 *  unambiguous, so a Discord-only owner can register the guild without first
 *  completing HQ-web onboarding. No-op unless the alliance is native, has no
 *  owner member recorded, and the linked commander is the sole active R5 in the
 *  local roster. Never touches Ashed-sourced alliances and never overwrites an
 *  existing owner. Idempotent. */
export async function maybeClaimNativeOwnerFromDiscordLink(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<void> {
  const alliance = await getAllianceById(input.allianceId);
  if (!alliance) return;
  if (alliance.operatingMode !== "native") return;
  if (alliance.ownerMemberExternalId) return;

  const db = getDb();
  const activeR5 = await db
    .select({ ashedMemberId: schema.allianceMembers.ashedMemberId })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.status, "active"),
        eq(schema.allianceMembers.allianceRank, 5),
      ),
    );

  const claimMemberId = nativeOwnerClaimMemberId({
    isNative: true,
    ownerAlreadySet: false,
    linkedAshedMemberId: input.ashedMemberId,
    activeR5MemberIds: activeR5.map((row) => row.ashedMemberId),
  });
  if (!claimMemberId) return;

  await db
    .update(schema.alliances)
    .set({ ownerMemberExternalId: claimMemberId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.alliances.id, input.allianceId),
        isNull(schema.alliances.ownerMemberExternalId),
      ),
    );
}
