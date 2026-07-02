import "server-only";

import { and, count, eq, gte, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { resolveOwnerHasCommanderLink } from "@/lib/alliance-setup-guide-status.shared";
import { sessionHasPermission } from "@/lib/rbac/context";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

const ROSTER_HARDENING_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

export async function loadAllianceSetupGuideSignals(input: {
  allianceId: string;
  hqUserId: string;
  sessionId: string;
}): Promise<{
  operatingMode: Awaited<ReturnType<typeof getAllianceOperatingMode>>;
  gameServerLinked: boolean;
  ownerHasCommanderLink: boolean;
  viewerHasCommanderLink: boolean;
  hasTeamInvite: boolean;
  discordGuildRegistered: boolean;
  ashedConnected: boolean;
  rosterHardeningComplete: boolean;
  rosterPopulated: boolean;
  viewerIsOfficer: boolean;
  setupGuideDismissed: boolean;
  setupGuideShowOnDashboard: boolean;
}> {
  const db = getDb();
  const operatingMode = await getAllianceOperatingMode(input.allianceId);
  const viewerIsOfficer = await sessionHasPermission(
    input.sessionId,
    "members:write",
  );

  const [
    allianceRow,
    membershipRow,
    memberCountRow,
    inviteCountRow,
    guildCountRow,
    credentialRow,
    rosterVideoAuditRow,
    rosterVideoJobRow,
  ] = await Promise.all([
    db
      .select({
        gameServerId: schema.alliances.gameServerId,
        ownerHqUserId: schema.alliances.ownerHqUserId,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, input.allianceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        setupGuideDismissed: schema.allianceMemberships.setupGuideDismissed,
        setupGuideShowOnDashboard:
          schema.allianceMemberships.setupGuideShowOnDashboard,
        roleId: schema.allianceMemberships.roleId,
      })
      .from(schema.allianceMemberships)
      .where(
        and(
          eq(schema.allianceMemberships.allianceId, input.allianceId),
          eq(schema.allianceMemberships.hqUserId, input.hqUserId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ value: count() })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          ne(schema.allianceMembers.status, "former"),
        ),
      )
      .then((rows) => Number(rows[0]?.value ?? 0)),
    db
      .select({ value: count() })
      .from(schema.hqInvites)
      .where(eq(schema.hqInvites.allianceId, input.allianceId))
      .then((rows) => Number(rows[0]?.value ?? 0)),
    db
      .select({ value: count() })
      .from(schema.discordGuildAlliances)
      .where(eq(schema.discordGuildAlliances.allianceId, input.allianceId))
      .then((rows) => Number(rows[0]?.value ?? 0)),
    db
      .select({ id: schema.allianceAshedCredentials.id })
      .from(schema.allianceAshedCredentials)
      .where(eq(schema.allianceAshedCredentials.allianceId, input.allianceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.allianceId, input.allianceId),
          eq(schema.auditLog.action, "members.roster_video_commit"),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ id: schema.videoJobs.id })
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.allianceId, input.allianceId),
          eq(schema.videoJobs.status, "complete"),
          eq(schema.videoJobs.scoreTarget, MEMBER_ROSTER_VIDEO_SCORE_TARGET),
          gte(
            schema.videoJobs.updatedAt,
            new Date(Date.now() - ROSTER_HARDENING_LOOKBACK_MS),
          ),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const ownerHqUserId = allianceRow?.ownerHqUserId ?? null;
  const viewerRoleName = membershipRow?.roleId
    ? systemRoleNameForId(membershipRow.roleId)
    : null;

  const viewerHasCommanderLink = Boolean(
    await db
      .select({ id: schema.hqMemberLinks.id })
      .from(schema.hqMemberLinks)
      .where(
        and(
          eq(schema.hqMemberLinks.allianceId, input.allianceId),
          eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
  );

  const ownerUserHasLink =
    ownerHqUserId && ownerHqUserId !== input.hqUserId
      ? Boolean(
          await db
            .select({ id: schema.hqMemberLinks.id })
            .from(schema.hqMemberLinks)
            .where(
              and(
                eq(schema.hqMemberLinks.allianceId, input.allianceId),
                eq(schema.hqMemberLinks.hqUserId, ownerHqUserId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0]),
        )
      : false;

  const ownerHasCommanderLink = resolveOwnerHasCommanderLink({
    ownerHqUserId,
    ownerUserHasLink,
    viewerHqUserId: input.hqUserId,
    viewerHasCommanderLink,
    viewerRoleName,
  });

  return {
    operatingMode,
    gameServerLinked: Boolean(allianceRow?.gameServerId),
    ownerHasCommanderLink,
    viewerHasCommanderLink,
    hasTeamInvite: inviteCountRow > 0,
    discordGuildRegistered: guildCountRow > 0,
    ashedConnected: Boolean(credentialRow),
    rosterHardeningComplete: Boolean(rosterVideoAuditRow ?? rosterVideoJobRow),
    rosterPopulated: memberCountRow > 0,
    viewerIsOfficer,
    setupGuideDismissed: membershipRow?.setupGuideDismissed === 1,
    setupGuideShowOnDashboard:
      membershipRow?.setupGuideShowOnDashboard !== 0,
  };
}
