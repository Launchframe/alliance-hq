import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  denormalizeGameUidOnMember,
  openMemberAllianceTenure,
} from "@/lib/members/member-tenure.server";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { inheritHqMemberLinkToDiscordIfLinked } from "@/lib/member-link/inherit-hq-to-discord.server";
import { hasConflictingHqGameUidClaim } from "@/lib/member-link/link-claim-guards.shared";
import type { LinkPendingState } from "@/lib/vr/types";

const PENDING_TTL_MS = 30 * 60 * 1000;
/** Matches roster link action token TTL — owner approval can take days. */
const AWAITING_OWNER_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function pendingExpiresAt(pending: LinkPendingState): Date {
  const ttlMs =
    pending.kind === "link_awaiting_owner"
      ? AWAITING_OWNER_PENDING_TTL_MS
      : PENDING_TTL_MS;
  return new Date(Date.now() + ttlMs);
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
      ...(typeof r.gameUserLevel === "number"
        ? { gameUserLevel: r.gameUserLevel }
        : {}),
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
  if (
    r.kind === "link_awaiting_owner" &&
    typeof r.requestId === "string" &&
    typeof r.gameUserName === "string"
  ) {
    return {
      kind: "link_awaiting_owner",
      requestId: r.requestId,
      gameUserName: r.gameUserName,
    };
  }
  return null;
}

export async function getHqMemberLinkForUser(
  allianceId: string,
  hqUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getHqMemberLinkByAllianceAndMember(
  allianceId: string,
  ashedMemberId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function sessionHasHqMemberLink(
  allianceId: string,
  hqUserId: string,
): Promise<boolean> {
  const link = await getHqMemberLinkForUser(allianceId, hqUserId);
  return link != null;
}

export type LinkHqMemberResult =
  | { ok: true; link: typeof schema.hqMemberLinks.$inferSelect; mode: "created" | "updated" }
  | { ok: false; reason: "member_linked_to_other_user" };

async function isGameUidClaimedByOtherHqUser(input: {
  allianceId: string;
  hqUserId: string;
  ashedMemberId: string;
  gameUid: string;
}): Promise<boolean> {
  const gameUid = input.gameUid.trim();
  if (!gameUid) return false;

  const db = getDb();
  const [hqClaims, discordClaims] = await Promise.all([
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

  return hasConflictingHqGameUidClaim({
    hqUserId: input.hqUserId,
    ashedMemberId: input.ashedMemberId,
    hqClaims,
    discordClaims,
  });
}

export async function linkHqMember(input: {
  allianceId: string;
  hqUserId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  gameUid: string;
}): Promise<LinkHqMemberResult> {
  const db = getDb();
  const now = new Date();

  if (await isGameUidClaimedByOtherHqUser(input)) {
    return { ok: false, reason: "member_linked_to_other_user" };
  }

  const existingMemberLink = await getHqMemberLinkByAllianceAndMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (
    existingMemberLink &&
    existingMemberLink.hqUserId !== input.hqUserId
  ) {
    return { ok: false, reason: "member_linked_to_other_user" };
  }

  const existingUserLink = await getHqMemberLinkForUser(
    input.allianceId,
    input.hqUserId,
  );

  if (existingUserLink) {
    const [row] = await db
      .update(schema.hqMemberLinks)
      .set({
        ashedMemberId: input.ashedMemberId,
        memberDisplayName: input.memberDisplayName ?? null,
        gameUid: input.gameUid,
        updatedAt: now,
      })
      .where(eq(schema.hqMemberLinks.id, existingUserLink.id))
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
      hqUserId: input.hqUserId,
    });
    await inheritHqMemberLinkToDiscordIfLinked({
      hqUserId: input.hqUserId,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: input.memberDisplayName,
      gameUid: input.gameUid,
    });
    return { ok: true, link: row!, mode: "updated" };
  }

  const [row] = await db
    .insert(schema.hqMemberLinks)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
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
    hqUserId: input.hqUserId,
    joinedAt: now,
  });
  await inheritHqMemberLinkToDiscordIfLinked({
    hqUserId: input.hqUserId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.memberDisplayName,
    gameUid: input.gameUid,
  });

  return { ok: true, link: row!, mode: "created" };
}

export async function getHqMemberLinkPending(
  allianceId: string,
  hqUserId: string,
): Promise<{ allianceId: string; pending: LinkPendingState } | null> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.hqMemberLinkPending)
    .where(
      and(
        eq(schema.hqMemberLinkPending.allianceId, allianceId),
        eq(schema.hqMemberLinkPending.hqUserId, hqUserId),
        gt(schema.hqMemberLinkPending.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    await db
      .delete(schema.hqMemberLinkPending)
      .where(
        and(
          eq(schema.hqMemberLinkPending.allianceId, allianceId),
          eq(schema.hqMemberLinkPending.hqUserId, hqUserId),
        ),
      );
    return null;
  }

  const pending = parseLinkPending(row.pendingJson);
  if (!pending) {
    await saveHqMemberLinkPending(allianceId, hqUserId, null);
    return null;
  }

  return { allianceId: row.allianceId, pending };
}

export async function saveHqMemberLinkPending(
  allianceId: string,
  hqUserId: string,
  pending: LinkPendingState | null,
): Promise<void> {
  const db = getDb();
  if (!pending) {
    await db
      .delete(schema.hqMemberLinkPending)
      .where(
        and(
          eq(schema.hqMemberLinkPending.allianceId, allianceId),
          eq(schema.hqMemberLinkPending.hqUserId, hqUserId),
        ),
      );
    return;
  }

  const expiresAt = pendingExpiresAt(pending);
  await db
    .insert(schema.hqMemberLinkPending)
    .values({
      allianceId,
      hqUserId,
      pendingJson: pending,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.hqMemberLinkPending.allianceId,
        schema.hqMemberLinkPending.hqUserId,
      ],
      set: {
        pendingJson: pending,
        expiresAt,
        updatedAt: new Date(),
      },
    });
}

export async function syncPrimaryGameUidFromHqMemberLink(
  hqUserId: string,
  gameUid: string,
): Promise<void> {
  const trimmed = gameUid.trim();
  if (!trimmed) return;

  const db = getDb();
  await db
    .update(schema.hqUsers)
    .set({ primaryGameUid: trimmed, updatedAt: new Date() })
    .where(eq(schema.hqUsers.id, hqUserId));
}

/**
 * When a user who is the alliance owner completes their first member link,
 * record their ashedMemberId on the alliance so Discord /link-alliance owner
 * proof (callerOwnsAllianceViaMemberLink) can verify them without Ashed creds.
 * Only writes if ownerMemberExternalId is not already set.
 */
export async function maybeSetOwnerMemberExternalId(input: {
  allianceId: string;
  hqUserId: string;
  ashedMemberId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({ ownerMemberExternalId: input.ashedMemberId })
    .where(
      and(
        eq(schema.alliances.id, input.allianceId),
        eq(schema.alliances.ownerHqUserId, input.hqUserId),
        isNull(schema.alliances.ownerMemberExternalId),
      ),
    );
}
