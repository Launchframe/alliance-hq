import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { writeAuditLog } from "@/lib/bff/audit";
import { revokeAshedMembershipsForHqUser } from "@/lib/ashed/rebind-session";
import { getDb, schema } from "@/lib/db";
import { inheritHqMemberLinksToDiscord } from "@/lib/member-link/inherit-hq-to-discord.server";

export type MergeHqUsersErrorCode =
  | "source_not_found"
  | "same_account"
  | "proof_expired"
  | "proof_required"
  | "commander_conflict"
  | "discord_conflict"
  | "ashed_identity_conflict"
  | "platform_maintainer"
  | "nothing_to_merge"
  | "invalid_code";

export class MergeHqUsersError extends Error {
  constructor(
    message: string,
    readonly code: MergeHqUsersErrorCode,
  ) {
    super(message);
    this.name = "MergeHqUsersError";
  }
}

export type MergePreviewAlliance = {
  allianceId: string;
  allianceName: string;
  allianceTag: string | null;
  commanderNames: string[];
};

export type MergeHqUsersPreview = {
  sourceEmail: string;
  alliances: MergePreviewAlliance[];
};

export type MergeHqUsersResult = {
  mergedFromHqUserId: string;
  movedAllianceIds: string[];
};

export async function loadHqUserIdByEmail(
  emailRaw: string,
): Promise<string | null> {
  const email = normalizeAshedEmail(emailRaw);
  if (!email) {
    return null;
  }

  const db = getDb();
  const [row] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, email))
    .limit(1);

  return row?.id ?? null;
}

async function loadHqUserRow(hqUserId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.hqUsers.id,
      email: schema.hqUsers.email,
      ashedUserId: schema.hqUsers.ashedUserId,
      isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  return row ?? null;
}

async function loadDiscordHqLink(hqUserId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      discordUserId: schema.discordHqLinks.discordUserId,
    })
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.hqUserId, hqUserId))
    .limit(1);

  return row ?? null;
}

function commanderDisplayName(link: {
  memberDisplayName: string | null;
  ashedMemberId: string;
}): string {
  return link.memberDisplayName?.trim() || "Commander";
}

export async function assessMergeHqUsers(input: {
  canonicalHqUserId: string;
  sourceHqUserId: string;
}): Promise<MergeHqUsersPreview> {
  const canonicalId = input.canonicalHqUserId.trim();
  const sourceId = input.sourceHqUserId.trim();

  if (!canonicalId || !sourceId) {
    throw new MergeHqUsersError("Source account not found.", "source_not_found");
  }

  if (canonicalId === sourceId) {
    throw new MergeHqUsersError("That is this account.", "same_account");
  }

  const [canonical, source] = await Promise.all([
    loadHqUserRow(canonicalId),
    loadHqUserRow(sourceId),
  ]);

  if (!source) {
    throw new MergeHqUsersError("Source account not found.", "source_not_found");
  }
  if (!canonical) {
    throw new MergeHqUsersError("Source account not found.", "source_not_found");
  }

  if (canonical.isPlatformMaintainer || source.isPlatformMaintainer) {
    throw new MergeHqUsersError(
      "Platform maintainer accounts cannot be merged here.",
      "platform_maintainer",
    );
  }

  if (
    canonical.ashedUserId &&
    source.ashedUserId &&
    canonical.ashedUserId !== source.ashedUserId
  ) {
    throw new MergeHqUsersError(
      "These accounts are linked to different Ashed identities.",
      "ashed_identity_conflict",
    );
  }

  const [canonicalDiscord, sourceDiscord] = await Promise.all([
    loadDiscordHqLink(canonicalId),
    loadDiscordHqLink(sourceId),
  ]);

  if (
    canonicalDiscord &&
    sourceDiscord &&
    canonicalDiscord.discordUserId !== sourceDiscord.discordUserId
  ) {
    throw new MergeHqUsersError(
      "Both accounts are linked to different Discord users.",
      "discord_conflict",
    );
  }

  const db = getDb();
  const [canonicalLinks, sourceLinks, sourceMemberships, canonicalMemberships] =
    await Promise.all([
      db
        .select({
          allianceId: schema.hqMemberLinks.allianceId,
          ashedMemberId: schema.hqMemberLinks.ashedMemberId,
          memberDisplayName: schema.hqMemberLinks.memberDisplayName,
        })
        .from(schema.hqMemberLinks)
        .where(eq(schema.hqMemberLinks.hqUserId, canonicalId)),
      db
        .select({
          allianceId: schema.hqMemberLinks.allianceId,
          ashedMemberId: schema.hqMemberLinks.ashedMemberId,
          memberDisplayName: schema.hqMemberLinks.memberDisplayName,
        })
        .from(schema.hqMemberLinks)
        .where(eq(schema.hqMemberLinks.hqUserId, sourceId)),
      db
        .select({ allianceId: schema.allianceMemberships.allianceId })
        .from(schema.allianceMemberships)
        .where(eq(schema.allianceMemberships.hqUserId, sourceId)),
      db
        .select({ allianceId: schema.allianceMemberships.allianceId })
        .from(schema.allianceMemberships)
        .where(eq(schema.allianceMemberships.hqUserId, canonicalId)),
    ]);

  const canonicalLinkByAlliance = new Map(
    canonicalLinks.map((row) => [row.allianceId, row]),
  );

  for (const sourceLink of sourceLinks) {
    const canonicalLink = canonicalLinkByAlliance.get(sourceLink.allianceId);
    if (
      canonicalLink &&
      canonicalLink.ashedMemberId !== sourceLink.ashedMemberId
    ) {
      throw new MergeHqUsersError(
        "Both accounts have different commanders linked.",
        "commander_conflict",
      );
    }
  }

  const [sourceAuthCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hqAuthAccounts)
    .where(eq(schema.hqAuthAccounts.hqUserId, sourceId));

  const hasMergeableData =
    sourceMemberships.length > 0 ||
    sourceLinks.length > 0 ||
    sourceDiscord !== null ||
    (sourceAuthCount?.count ?? 0) > 0 ||
    (await db
      .select({ id: schema.hqInvites.id })
      .from(schema.hqInvites)
      .where(eq(schema.hqInvites.acceptedByHqUserId, sourceId))
      .limit(1)).length > 0;

  if (!hasMergeableData) {
    throw new MergeHqUsersError(
      "That account has nothing to move. Try changing your email instead.",
      "nothing_to_merge",
    );
  }

  const allianceIds = new Set<string>();
  for (const row of sourceMemberships) {
    allianceIds.add(row.allianceId);
  }
  for (const row of sourceLinks) {
    allianceIds.add(row.allianceId);
  }

  const canonicalAllianceIds = new Set(
    canonicalMemberships.map((row) => row.allianceId),
  );

  const previewAllianceIds = [...allianceIds].filter(
    (allianceId) => !canonicalAllianceIds.has(allianceId) || sourceLinks.some(
      (link) => link.allianceId === allianceId,
    ),
  );

  const alliances: MergePreviewAlliance[] = [];
  if (previewAllianceIds.length > 0) {
    const allianceRows = await db
      .select({
        id: schema.alliances.id,
        name: schema.alliances.name,
        tag: schema.alliances.tag,
      })
      .from(schema.alliances)
      .where(inArray(schema.alliances.id, previewAllianceIds));

    for (const alliance of allianceRows) {
      const commanderNames = sourceLinks
        .filter((link) => link.allianceId === alliance.id)
        .map(commanderDisplayName);
      alliances.push({
        allianceId: alliance.id,
        allianceName: alliance.name,
        allianceTag: alliance.tag,
        commanderNames,
      });
    }
  }

  return {
    sourceEmail: source.email,
    alliances,
  };
}

export async function mergeHqUsersIntoCanonical(input: {
  canonicalHqUserId: string;
  sourceHqUserId: string;
  sessionId?: string | null;
}): Promise<MergeHqUsersResult> {
  const preview = await assessMergeHqUsers({
    canonicalHqUserId: input.canonicalHqUserId,
    sourceHqUserId: input.sourceHqUserId,
  });

  const canonicalId = input.canonicalHqUserId.trim();
  const sourceId = input.sourceHqUserId.trim();
  const db = getDb();
  const now = new Date();

  const movedAllianceIds = preview.alliances.map((row) => row.allianceId);

  await db.transaction(async (tx) => {
    await revokeAshedMembershipsForHqUser(sourceId);

    const canonicalMemberships = await tx
      .select({
        allianceId: schema.allianceMemberships.allianceId,
      })
      .from(schema.allianceMemberships)
      .where(eq(schema.allianceMemberships.hqUserId, canonicalId));

    const canonicalAllianceIds = new Set(
      canonicalMemberships.map((row) => row.allianceId),
    );

    const sourceMemberships = await tx
      .select({
        id: schema.allianceMemberships.id,
        allianceId: schema.allianceMemberships.allianceId,
      })
      .from(schema.allianceMemberships)
      .where(eq(schema.allianceMemberships.hqUserId, sourceId));

    for (const membership of sourceMemberships) {
      if (canonicalAllianceIds.has(membership.allianceId)) {
        await tx
          .delete(schema.allianceMemberships)
          .where(eq(schema.allianceMemberships.id, membership.id));
      } else {
        await tx
          .update(schema.allianceMemberships)
          .set({ hqUserId: canonicalId, updatedAt: now })
          .where(eq(schema.allianceMemberships.id, membership.id));
      }
    }

    const canonicalLinks = await tx
      .select({
        allianceId: schema.hqMemberLinks.allianceId,
        ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      })
      .from(schema.hqMemberLinks)
      .where(eq(schema.hqMemberLinks.hqUserId, canonicalId));

    const canonicalMemberIds = new Set(
      canonicalLinks.map((row) => `${row.allianceId}:${row.ashedMemberId}`),
    );

    const sourceLinks = await tx
      .select({
        id: schema.hqMemberLinks.id,
        allianceId: schema.hqMemberLinks.allianceId,
        ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      })
      .from(schema.hqMemberLinks)
      .where(eq(schema.hqMemberLinks.hqUserId, sourceId));

    for (const link of sourceLinks) {
      const key = `${link.allianceId}:${link.ashedMemberId}`;
      if (canonicalMemberIds.has(key)) {
        await tx
          .delete(schema.hqMemberLinks)
          .where(eq(schema.hqMemberLinks.id, link.id));
      } else {
        await tx
          .update(schema.hqMemberLinks)
          .set({ hqUserId: canonicalId, updatedAt: now })
          .where(eq(schema.hqMemberLinks.id, link.id));
      }
    }

    await tx
      .update(schema.hqInvites)
      .set({ acceptedByHqUserId: canonicalId })
      .where(eq(schema.hqInvites.acceptedByHqUserId, sourceId));

    const sourceAuthAccounts = await tx
      .select()
      .from(schema.hqAuthAccounts)
      .where(eq(schema.hqAuthAccounts.hqUserId, sourceId));

    for (const account of sourceAuthAccounts) {
      const [existing] = await tx
        .select({ id: schema.hqAuthAccounts.id })
        .from(schema.hqAuthAccounts)
        .where(
          and(
            eq(schema.hqAuthAccounts.provider, account.provider),
            eq(
              schema.hqAuthAccounts.providerAccountId,
              account.providerAccountId,
            ),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .delete(schema.hqAuthAccounts)
          .where(eq(schema.hqAuthAccounts.id, account.id));
      } else {
        await tx
          .update(schema.hqAuthAccounts)
          .set({ hqUserId: canonicalId })
          .where(eq(schema.hqAuthAccounts.id, account.id));
      }
    }

    const sourceProviders = await tx
      .select()
      .from(schema.hqUserAuthProviders)
      .where(eq(schema.hqUserAuthProviders.hqUserId, sourceId));

    for (const provider of sourceProviders) {
      const [existing] = await tx
        .select({ id: schema.hqUserAuthProviders.id })
        .from(schema.hqUserAuthProviders)
        .where(
          and(
            eq(schema.hqUserAuthProviders.hqUserId, canonicalId),
            eq(schema.hqUserAuthProviders.provider, provider.provider),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .delete(schema.hqUserAuthProviders)
          .where(eq(schema.hqUserAuthProviders.id, provider.id));
      } else {
        await tx
          .update(schema.hqUserAuthProviders)
          .set({ hqUserId: canonicalId, updatedAt: now })
          .where(eq(schema.hqUserAuthProviders.id, provider.id));
      }
    }

    const [canonicalDiscord, sourceDiscord] = await Promise.all([
      tx
        .select({ discordUserId: schema.discordHqLinks.discordUserId })
        .from(schema.discordHqLinks)
        .where(eq(schema.discordHqLinks.hqUserId, canonicalId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select({ discordUserId: schema.discordHqLinks.discordUserId })
        .from(schema.discordHqLinks)
        .where(eq(schema.discordHqLinks.hqUserId, sourceId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    if (!canonicalDiscord && sourceDiscord) {
      await tx
        .update(schema.discordHqLinks)
        .set({ hqUserId: canonicalId })
        .where(eq(schema.discordHqLinks.discordUserId, sourceDiscord.discordUserId));
    }

    const sourcePending = await tx
      .select({
        allianceId: schema.hqMemberLinkPending.allianceId,
      })
      .from(schema.hqMemberLinkPending)
      .where(eq(schema.hqMemberLinkPending.hqUserId, sourceId));

    for (const pending of sourcePending) {
      const [canonicalPending] = await tx
        .select({ allianceId: schema.hqMemberLinkPending.allianceId })
        .from(schema.hqMemberLinkPending)
        .where(
          and(
            eq(schema.hqMemberLinkPending.hqUserId, canonicalId),
            eq(schema.hqMemberLinkPending.allianceId, pending.allianceId),
          ),
        )
        .limit(1);

      if (canonicalPending) {
        await tx
          .delete(schema.hqMemberLinkPending)
          .where(
            and(
              eq(schema.hqMemberLinkPending.hqUserId, sourceId),
              eq(schema.hqMemberLinkPending.allianceId, pending.allianceId),
            ),
          );
      } else {
        await tx
          .update(schema.hqMemberLinkPending)
          .set({ hqUserId: canonicalId, updatedAt: now })
          .where(
            and(
              eq(schema.hqMemberLinkPending.hqUserId, sourceId),
              eq(schema.hqMemberLinkPending.allianceId, pending.allianceId),
            ),
          );
      }
    }

    await tx
      .update(schema.hqRosterLinkRequests)
      .set({ hqUserId: canonicalId })
      .where(eq(schema.hqRosterLinkRequests.hqUserId, sourceId));

    await tx
      .update(schema.hqMemberOnboardingReviews)
      .set({ hqUserId: canonicalId, updatedAt: now })
      .where(eq(schema.hqMemberOnboardingReviews.hqUserId, sourceId));

    await tx
      .update(schema.hqMemberLinkHelpRequests)
      .set({ hqUserId: canonicalId })
      .where(eq(schema.hqMemberLinkHelpRequests.hqUserId, sourceId));

    await tx
      .delete(schema.sessions)
      .where(
        and(
          eq(schema.sessions.hqUserId, sourceId),
          ne(schema.sessions.id, input.sessionId ?? ""),
        ),
      );

    await tx.delete(schema.hqUsers).where(eq(schema.hqUsers.id, sourceId));
  });

  const discordLink = await loadDiscordHqLink(canonicalId);
  if (discordLink) {
    await inheritHqMemberLinksToDiscord({
      discordUserId: discordLink.discordUserId,
      hqUserId: canonicalId,
    });
  }

  if (input.sessionId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      allianceId: null,
      hqUserId: canonicalId,
      action: "hq.merge",
      resourceType: "hq_user",
      resourceId: canonicalId,
      metadata: {
        mergedFromHqUserId: sourceId,
        movedAllianceIds,
      },
    });
  }

  return {
    mergedFromHqUserId: sourceId,
    movedAllianceIds,
  };
}
