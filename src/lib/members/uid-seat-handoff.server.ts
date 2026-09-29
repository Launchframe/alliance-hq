import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { denormalizeGameUidOnMember } from "@/lib/members/member-tenure.server";
import { normalizeName } from "@/lib/vr/link-helpers";

type DiscordMemberLinkRow = typeof schema.discordMemberLinks.$inferSelect;
type HqMemberLinkRow = typeof schema.hqMemberLinks.$inferSelect;

export type RosterSeatMember = {
  ashedMemberId: string;
  currentName: string;
  status: string;
  gameUid: string | null;
};

export async function loadAllianceRosterMember(
  allianceId: string,
  ashedMemberId: string,
): Promise<RosterSeatMember | null> {
  const db = getDb();
  const [row] = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      status: schema.allianceMembers.status,
      gameUid: schema.allianceMembers.gameUid,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findActiveMemberByGameUid(
  allianceId: string,
  gameUid: string,
) {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.gameUid, gameUid),
        eq(schema.allianceMembers.status, "active"),
      ),
    )
    .limit(2);
  if (rows.length !== 1) return null;
  return rows[0] ?? null;
}

async function loadActiveRosterForNameMatch(allianceId: string) {
  const db = getDb();
  return db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
      status: schema.allianceMembers.status,
      gameUid: schema.allianceMembers.gameUid,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    )
    .limit(5000);
}

function findUniqueLiveSeatByExactName(
  members: {
    ashedMemberId: string;
    currentName: string;
    previousNamesJson: string[] | null;
    status: string;
    gameUid: string | null;
  }[],
  gameUserName: string,
): { ashedMemberId: string; currentName: string; gameUid: string | null } | null {
  const needle = normalizeName(gameUserName);
  if (!needle) return null;
  const matches: {
    ashedMemberId: string;
    currentName: string;
    gameUid: string | null;
  }[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    if (member.status === "former") continue;
    const names = [member.currentName, ...(member.previousNamesJson ?? [])];
    if (!names.some((name) => normalizeName(name) === needle)) continue;
    if (seen.has(member.ashedMemberId)) continue;
    seen.add(member.ashedMemberId);
    matches.push({
      ashedMemberId: member.ashedMemberId,
      currentName: member.currentName,
      gameUid: member.gameUid,
    });
    if (matches.length > 1) return null;
  }
  return matches[0] ?? null;
}

async function discordSeatOccupiedByOther(input: {
  allianceId: string;
  ashedMemberId: string;
  discordUserId: string | null;
}): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ discordUserId: schema.discordMemberLinks.discordUserId })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, input.allianceId),
        eq(schema.discordMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);
  if (!row) return false;
  if (!input.discordUserId) return true;
  return row.discordUserId !== input.discordUserId;
}

/** Same-UID HQ claim on the live seat is ours; a different UID is another HQ user. */
async function hqSeatOccupiedByOther(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUid: string;
}): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ gameUid: schema.hqMemberLinks.gameUid })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);
  if (!row) return false;
  return row.gameUid.trim() !== input.gameUid.trim();
}

export async function liveSeatOccupiedByOther(input: {
  allianceId: string;
  ashedMemberId: string;
  discordUserId: string | null;
  gameUid: string;
}): Promise<boolean> {
  if (
    await discordSeatOccupiedByOther({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      discordUserId: input.discordUserId,
    })
  ) {
    return true;
  }
  return hqSeatOccupiedByOther({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid: input.gameUid,
  });
}

type SeatHandoffDb = {
  update: ReturnType<typeof getDb>["update"];
};

async function retargetHqMemberLinkForSeatHandoff(
  db: SeatHandoffDb,
  input: {
    allianceId: string;
    gameUid: string;
    previousAshedMemberId: string;
    ashedMemberId: string;
    currentName: string;
    now: Date;
  },
): Promise<string | null> {
  const trimmed = input.gameUid.trim();
  if (!trimmed) return null;

  const [updated] = await db
    .update(schema.hqMemberLinks)
    .set({
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: input.currentName,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.gameUid, trimmed),
        eq(schema.hqMemberLinks.ashedMemberId, input.previousAshedMemberId),
      ),
    )
    .returning({ hqUserId: schema.hqMemberLinks.hqUserId });

  return updated?.hqUserId ?? null;
}

export async function rebindFormerSeatToLive(input: {
  allianceId: string;
  previousAshedMemberId: string;
  liveAshedMemberId: string;
  currentName: string;
  gameUid: string;
  discordLink?: DiscordMemberLinkRow | null;
}): Promise<{ discordLink: DiscordMemberLinkRow | null; hqUserId: string | null }> {
  const now = new Date();
  const db = getDb();
  const gameUid = input.gameUid.trim();

  const { nextDiscord, hqUserId } = await db.transaction(async (tx) => {
    let nextDiscord: DiscordMemberLinkRow | null = input.discordLink ?? null;
    if (input.discordLink) {
      const [updated] = await tx
        .update(schema.discordMemberLinks)
        .set({
          ashedMemberId: input.liveAshedMemberId,
          memberDisplayName: input.currentName,
          updatedAt: now,
        })
        .where(eq(schema.discordMemberLinks.id, input.discordLink.id))
        .returning();
      nextDiscord = updated ?? {
        ...input.discordLink,
        ashedMemberId: input.liveAshedMemberId,
        memberDisplayName: input.currentName,
        updatedAt: now,
      };
    }

    const hqUserId = await retargetHqMemberLinkForSeatHandoff(tx, {
      allianceId: input.allianceId,
      gameUid,
      previousAshedMemberId: input.previousAshedMemberId,
      ashedMemberId: input.liveAshedMemberId,
      currentName: input.currentName,
      now,
    });

    return { nextDiscord, hqUserId };
  });

  await denormalizeGameUidOnMember({
    allianceId: input.allianceId,
    ashedMemberId: input.liveAshedMemberId,
    gameUid,
  });

  const { syncCommanderIdentityFromMemberLink } = await import(
    "@/lib/members/commander-identity.server"
  );
  await syncCommanderIdentityFromMemberLink({
    allianceId: input.allianceId,
    ashedMemberId: input.liveAshedMemberId,
    gameUid,
    memberDisplayName: input.currentName,
    hqUserId: hqUserId ?? undefined,
  });

  return { discordLink: nextDiscord, hqUserId };
}

export async function resolveLiveSeatForFormerClaim(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUid: string;
  discordUserId: string | null;
}): Promise<{ ashedMemberId: string; currentName: string } | null> {
  const gameUid = input.gameUid.trim();
  if (!gameUid) return null;

  const occupancy = {
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    gameUid,
  };

  const byUid = await findActiveMemberByGameUid(input.allianceId, gameUid);
  if (byUid && byUid.ashedMemberId !== input.ashedMemberId) {
    if (
      await liveSeatOccupiedByOther({
        ...occupancy,
        ashedMemberId: byUid.ashedMemberId,
      })
    ) {
      return null;
    }
    return { ashedMemberId: byUid.ashedMemberId, currentName: byUid.currentName };
  }

  const lookup = await lookupPlayerByUid(gameUid);
  if (!lookup.ok) return null;

  const members = await loadActiveRosterForNameMatch(input.allianceId);
  const match = findUniqueLiveSeatByExactName(members, lookup.gameUserName);
  if (!match || match.ashedMemberId === input.ashedMemberId) return null;
  const liveUid = match.gameUid?.trim() ?? "";
  if (liveUid && liveUid !== gameUid) return null;
  if (
    await liveSeatOccupiedByOther({
      ...occupancy,
      ashedMemberId: match.ashedMemberId,
    })
  ) {
    return null;
  }
  return { ashedMemberId: match.ashedMemberId, currentName: match.currentName };
}

/**
 * Walk Discord and HQ links on former Ashed seats and retarget them onto the
 * live roster row for the same Last War identity (no steal).
 */
export async function rematerializeFormerSeatLinksForAlliance(
  allianceId: string,
): Promise<void> {
  const db = getDb();
  const former = await db
    .select({ ashedMemberId: schema.allianceMembers.ashedMemberId })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.status, "former"),
      ),
    )
    .limit(5000);
  if (former.length === 0) return;

  const formerIds = former.map((row) => row.ashedMemberId);
  const discordLinks = await db
    .select()
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, allianceId),
        inArray(schema.discordMemberLinks.ashedMemberId, formerIds),
      ),
    )
    .limit(5000);
  const hqLinks = await db
    .select()
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        inArray(schema.hqMemberLinks.ashedMemberId, formerIds),
      ),
    )
    .limit(5000);

  type Job = {
    previousAshedMemberId: string;
    gameUid: string;
    discordLink: DiscordMemberLinkRow | null;
    discordUserId: string | null;
  };
  const jobs = new Map<string, Job>();

  const addJob = (
    previousAshedMemberId: string,
    gameUid: string,
    extra: Partial<Job>,
  ) => {
    const trimmed = gameUid.trim();
    if (!trimmed) return;
    const key = `${trimmed}\0${previousAshedMemberId}`;
    const existing = jobs.get(key);
    jobs.set(key, {
      previousAshedMemberId,
      gameUid: trimmed,
      discordLink: extra.discordLink ?? existing?.discordLink ?? null,
      discordUserId: extra.discordUserId ?? existing?.discordUserId ?? null,
    });
  };

  for (const link of discordLinks) {
    addJob(link.ashedMemberId, link.gameUid, {
      discordLink: link,
      discordUserId: link.discordUserId,
    });
  }
  for (const link of hqLinks) {
    addJob(link.ashedMemberId, link.gameUid, {});
  }

  for (const job of jobs.values()) {
    try {
      const live = await resolveLiveSeatForFormerClaim({
        allianceId,
        ashedMemberId: job.previousAshedMemberId,
        gameUid: job.gameUid,
        discordUserId: job.discordUserId,
      });
      if (!live) continue;
      await rebindFormerSeatToLive({
        allianceId,
        previousAshedMemberId: job.previousAshedMemberId,
        liveAshedMemberId: live.ashedMemberId,
        currentName: live.currentName,
        gameUid: job.gameUid,
        discordLink: job.discordLink,
      });
    } catch {
      console.error("[roster-sync] former-seat rematerialize failed", {
        allianceId,
      });
    }
  }
}

export type { DiscordMemberLinkRow, HqMemberLinkRow };
