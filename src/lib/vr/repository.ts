import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { parseAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import {
  denormalizeGameUidOnMember,
  openMemberAllianceTenure,
} from "@/lib/members/member-tenure.server";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { buildFlagReason, peerMaxExcludingMember } from "@/lib/vr/anomaly";
import { MAX_DISCORD_LINKS_PER_USER } from "@/lib/vr/constants";
import {
  evaluateGuildRegistrationAuth,
  type GuildRegistrationAuth,
  nativeOwnerClaimMemberId,
  officerProvenByMemberRanks,
  ownerProvenByMemberLink,
} from "@/lib/vr/discord-guild-registration";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
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

export async function resolveSeasonKey(allianceId: string): Promise<string> {
  const envKey = process.env.DISCORD_ALLIANCE_SEASON_KEY?.trim();
  if (envKey) return envKey;

  const effective = await getEffectiveSeasonForAlliance(allianceId);
  return effective.seasonKey;
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

/** R4+ officer proof via linked commander rank on the local roster (same gate as VR reports). */
export async function callerIsAllianceOfficerViaMemberLink(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
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
