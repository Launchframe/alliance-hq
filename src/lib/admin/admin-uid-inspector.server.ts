import "server-only";

import { desc, eq, or, sql } from "drizzle-orm";

import type { AdminUidInspectorQueryParams } from "@/lib/admin/admin-uid-inspector-query.shared";
import { validateAdminUidInspectorGameUid } from "@/lib/admin/admin-uid-inspector-query.shared";
import type {
  AdminUidInspectorAllianceOption,
  AdminUidInspectorResult,
  AdminUidInspectorRosterSuggestions,
} from "@/lib/admin/admin-uid-inspector.shared";
import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import {
  lookupPlayerByUid,
  type LastWarPlayerLookupResult,
} from "@/lib/lastwar/player-lookup";
import {
  findExactMemberByName,
  findOfficerReviewRosterCandidates,
  findUniqueSubstringRosterCandidate,
} from "@/lib/vr/link-helpers";
import { loadAllianceMembersForMemberLink } from "@/lib/vr/member-roster";
import { getLinkedMemberIds } from "@/lib/vr/repository";

export type AdminUidInspectorResponse =
  | { ok: true; result: AdminUidInspectorResult }
  | { ok: false; error: "missing_uid" | "invalid_uid" };

function summarizeDiscordAuditResult(result: unknown): {
  memberTaken: boolean;
  linked: boolean;
  needsOfficerAttention: boolean;
  needsIdentityConfirmation: boolean;
  replyPreview: string | null;
  rosterSize: number | null;
  guildRegistered: boolean | null;
} {
  if (!result || typeof result !== "object") {
    return {
      memberTaken: false,
      linked: false,
      needsOfficerAttention: false,
      needsIdentityConfirmation: false,
      replyPreview: null,
      rosterSize: null,
      guildRegistered: null,
    };
  }

  const row = result as Record<string, unknown>;
  const diagnostics =
    row.diagnostics && typeof row.diagnostics === "object"
      ? (row.diagnostics as Record<string, unknown>)
      : null;

  const reply =
    typeof row.reply === "string"
      ? row.reply.replace(/\s+/g, " ").trim().slice(0, 160)
      : null;

  return {
    memberTaken: row.memberTaken === true,
    linked: row.linked === true,
    needsOfficerAttention: row.needsOfficerAttention === true,
    needsIdentityConfirmation: row.needsIdentityConfirmation === true,
    replyPreview: reply,
    rosterSize:
      typeof diagnostics?.rosterSize === "number" ? diagnostics.rosterSize : null,
    guildRegistered:
      typeof diagnostics?.guildRegistered === "boolean"
        ? diagnostics.guildRegistered
        : null,
  };
}

async function listAdminAllianceOptions(): Promise<AdminUidInspectorAllianceOption[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.alliances.id,
      name: schema.alliances.name,
      slug: schema.alliances.slug,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .orderBy(schema.alliances.name);
  return rows;
}

async function buildRosterSuggestions(input: {
  allianceId: string;
  gameUserName: string;
}): Promise<AdminUidInspectorRosterSuggestions | null> {
  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      name: schema.alliances.name,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!alliance) return null;

  const { members, rosterSource } = await loadAllianceMembersForMemberLink(
    input.allianceId,
  );
  const linkedMemberIds = await getLinkedMemberIds(input.allianceId);

  const exact = findExactMemberByName(members, input.gameUserName);
  const exactMatch = exact
    ? {
        ashedMemberId: exact.id,
        memberName: exact.current_name,
        isLinked: linkedMemberIds.has(exact.id),
      }
    : null;

  return {
    allianceId: alliance.id,
    allianceTag: alliance.tag,
    allianceName: alliance.name,
    rosterSource,
    rosterCount: members.length,
    exactMatch,
    substringSuggestion: findUniqueSubstringRosterCandidate(
      members,
      input.gameUserName,
    ),
    fuzzyCandidates: findOfficerReviewRosterCandidates(
      members,
      linkedMemberIds,
      input.gameUserName,
    ),
  };
}

export async function resolveAdminUidInspectorRequest(input: {
  params: AdminUidInspectorQueryParams;
  sessionId: string;
  hqUserId: string;
}): Promise<AdminUidInspectorResponse> {
  const alliances = await listAdminAllianceOptions();

  const validated = validateAdminUidInspectorGameUid(input.params.gameUid);
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error === "missing" ? "missing_uid" : "invalid_uid",
    };
  }

  const gameUid = validated.gameUid;
  const db = getDb();

  const lastWarLookup = (await lookupPlayerByUid(gameUid)) as LastWarPlayerLookupResult;

  const [commanderRow] = await db
    .select({
      id: schema.commanders.id,
      primaryName: schema.commanders.primaryName,
      gameServerNumber: schema.commanders.gameServerNumber,
      memberLevel: schema.commanders.memberLevel,
      heroPowerM: schema.commanders.heroPowerM,
      currentAllianceId: schema.commanders.currentAllianceId,
      updatedAt: schema.commanders.updatedAt,
      currentAllianceTag: schema.alliances.tag,
    })
    .from(schema.commanders)
    .leftJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.commanders.currentAllianceId),
    )
    .where(eq(schema.commanders.gameUid, gameUid))
    .limit(1);

  const hqMemberLinks = await db
    .select({
      id: schema.hqMemberLinks.id,
      allianceId: schema.hqMemberLinks.allianceId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
      hqUserId: schema.hqMemberLinks.hqUserId,
      hqUserEmail: schema.hqUsers.email,
      hqUserDisplayName: schema.hqUsers.displayName,
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      memberDisplayName: schema.hqMemberLinks.memberDisplayName,
      linkedAt: schema.hqMemberLinks.linkedAt,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinks.allianceId),
    )
    .innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.hqMemberLinks.hqUserId))
    .where(eq(schema.hqMemberLinks.gameUid, gameUid));

  const discordMemberLinks = await db
    .select({
      id: schema.discordMemberLinks.id,
      allianceId: schema.discordMemberLinks.allianceId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
      discordUserId: schema.discordMemberLinks.discordUserId,
      discordUsername: schema.discordMemberLinks.discordUsername,
      ashedMemberId: schema.discordMemberLinks.ashedMemberId,
      memberDisplayName: schema.discordMemberLinks.memberDisplayName,
      linkedAt: schema.discordMemberLinks.linkedAt,
    })
    .from(schema.discordMemberLinks)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.discordMemberLinks.allianceId),
    )
    .where(eq(schema.discordMemberLinks.gameUid, gameUid));

  const allianceMembers = await db
    .select({
      allianceId: schema.allianceMembers.allianceId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
      allianceSlug: schema.alliances.slug,
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      status: schema.allianceMembers.status,
      gameUid: schema.allianceMembers.gameUid,
    })
    .from(schema.allianceMembers)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.allianceMembers.allianceId),
    )
    .where(eq(schema.allianceMembers.gameUid, gameUid));

  const rosterLinkRequests = await db
    .select({
      id: schema.hqRosterLinkRequests.id,
      allianceId: schema.hqRosterLinkRequests.allianceId,
      allianceTag: schema.alliances.tag,
      allianceName: schema.alliances.name,
      status: schema.hqRosterLinkRequests.status,
      origin: schema.hqRosterLinkRequests.origin,
      reportedName: schema.hqRosterLinkRequests.reportedName,
      gameUserName: schema.hqRosterLinkRequests.gameUserName,
      hqUserId: schema.hqRosterLinkRequests.hqUserId,
      hqUserEmail: schema.hqUsers.email,
      discordUserId: schema.hqRosterLinkRequests.discordUserId,
      discordUsername: schema.hqRosterLinkRequests.discordUsername,
      suggestedTargetAshedMemberId:
        schema.hqRosterLinkRequests.suggestedTargetAshedMemberId,
      suggestionMethod: schema.hqRosterLinkRequests.suggestionMethod,
      suggestedMatchedRosterName:
        schema.hqRosterLinkRequests.suggestedMatchedRosterName,
      createdAt: schema.hqRosterLinkRequests.createdAt,
    })
    .from(schema.hqRosterLinkRequests)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqRosterLinkRequests.allianceId),
    )
    .leftJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.hqRosterLinkRequests.hqUserId),
    )
    .where(eq(schema.hqRosterLinkRequests.gameUid, gameUid))
    .orderBy(desc(schema.hqRosterLinkRequests.createdAt));

  const onboardingReviews = await db
    .select({
      id: schema.hqMemberOnboardingReviews.id,
      allianceId: schema.hqMemberOnboardingReviews.allianceId,
      allianceTag: schema.alliances.tag,
      allianceName: schema.alliances.name,
      status: schema.hqMemberOnboardingReviews.status,
      origin: schema.hqMemberOnboardingReviews.origin,
      gameUserName: schema.hqMemberOnboardingReviews.gameUserName,
      linkedAshedMemberId: schema.hqMemberOnboardingReviews.linkedAshedMemberId,
      hqUserId: schema.hqMemberOnboardingReviews.hqUserId,
      discordUserId: schema.hqMemberOnboardingReviews.discordUserId,
      createdAt: schema.hqMemberOnboardingReviews.createdAt,
    })
    .from(schema.hqMemberOnboardingReviews)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberOnboardingReviews.allianceId),
    )
    .where(eq(schema.hqMemberOnboardingReviews.gameUid, gameUid))
    .orderBy(desc(schema.hqMemberOnboardingReviews.createdAt));

  const memberLinkHelpRequests = await db
    .select({
      id: schema.hqMemberLinkHelpRequests.id,
      allianceId: schema.hqMemberLinkHelpRequests.allianceId,
      allianceTag: schema.alliances.tag,
      allianceName: schema.alliances.name,
      status: schema.hqMemberLinkHelpRequests.status,
      origin: schema.hqMemberLinkHelpRequests.origin,
      context: schema.hqMemberLinkHelpRequests.context,
      requesterHandle: schema.hqMemberLinkHelpRequests.requesterHandle,
      reportedName: schema.hqMemberLinkHelpRequests.reportedName,
      gameUserName: schema.hqMemberLinkHelpRequests.gameUserName,
      hqUserId: schema.hqMemberLinkHelpRequests.hqUserId,
      discordUserId: schema.hqMemberLinkHelpRequests.discordUserId,
      discordUsername: schema.hqMemberLinkHelpRequests.discordUsername,
      claimConflictReason: schema.hqMemberLinkHelpRequests.claimConflictReason,
      createdAt: schema.hqMemberLinkHelpRequests.createdAt,
    })
    .from(schema.hqMemberLinkHelpRequests)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinkHelpRequests.allianceId),
    )
    .where(eq(schema.hqMemberLinkHelpRequests.gameUid, gameUid))
    .orderBy(desc(schema.hqMemberLinkHelpRequests.createdAt));

  const auditUidMatch = or(
    sql`${schema.discordBotAudit.payloadJson}->>'gameUid' = ${gameUid}`,
    sql`${schema.discordBotAudit.resultJson}->'linkTarget'->>'gameUid' = ${gameUid}`,
  );

  const discordAuditRows = await db
    .select({
      id: schema.discordBotAudit.id,
      allianceId: schema.discordBotAudit.allianceId,
      allianceTag: schema.alliances.tag,
      command: schema.discordBotAudit.command,
      discordUserId: schema.discordBotAudit.discordUserId,
      createdAt: schema.discordBotAudit.createdAt,
      resultJson: schema.discordBotAudit.resultJson,
    })
    .from(schema.discordBotAudit)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.discordBotAudit.allianceId),
    )
    .where(auditUidMatch)
    .orderBy(desc(schema.discordBotAudit.createdAt))
    .limit(25);

  let rosterSuggestions: AdminUidInspectorRosterSuggestions | null = null;
  const rosterAllianceId = input.params.allianceIdForRoster?.trim();
  if (rosterAllianceId && lastWarLookup.ok) {
    rosterSuggestions = await buildRosterSuggestions({
      allianceId: rosterAllianceId,
      gameUserName: lastWarLookup.gameUserName,
    });
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    hqUserId: input.hqUserId,
    action: "admin_uid_inspector_lookup",
    resourceType: "game_uid",
    metadata: {
      gameUidLast4: gameUid.slice(-4),
      allianceIdForRoster: rosterAllianceId ?? null,
      bindingCounts: {
        hq: hqMemberLinks.length,
        discord: discordMemberLinks.length,
        rosterRequests: rosterLinkRequests.length,
      },
    },
  });

  return {
    ok: true,
    result: {
      gameUid,
      lastWarLookup,
      commander: commanderRow
        ? {
            id: commanderRow.id,
            primaryName: commanderRow.primaryName,
            gameServerNumber: commanderRow.gameServerNumber,
            memberLevel: commanderRow.memberLevel,
            heroPowerM: commanderRow.heroPowerM,
            currentAllianceId: commanderRow.currentAllianceId,
            currentAllianceTag: commanderRow.currentAllianceTag,
            updatedAt: commanderRow.updatedAt.toISOString(),
          }
        : null,
      hqMemberLinks: hqMemberLinks.map((row) => ({
        ...row,
        linkedAt: row.linkedAt.toISOString(),
      })),
      discordMemberLinks: discordMemberLinks.map((row) => ({
        ...row,
        linkedAt: row.linkedAt.toISOString(),
      })),
      allianceMembers,
      rosterLinkRequests: rosterLinkRequests.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      onboardingReviews: onboardingReviews.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      memberLinkHelpRequests: memberLinkHelpRequests.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      recentDiscordAudit: discordAuditRows.map((row) => {
        const summary = summarizeDiscordAuditResult(row.resultJson);
        return {
          id: row.id,
          allianceId: row.allianceId,
          allianceTag: row.allianceTag,
          command: row.command,
          discordUserId: row.discordUserId,
          createdAt: row.createdAt.toISOString(),
          ...summary,
        };
      }),
      rosterSuggestions,
      alliances,
    },
  };
}

/** Alliance picker only — before a UID search. */
export async function listAdminUidInspectorAlliances(): Promise<
  AdminUidInspectorAllianceOption[]
> {
  return listAdminAllianceOptions();
}
