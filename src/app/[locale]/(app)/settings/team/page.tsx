import { eq } from "drizzle-orm";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { SettingsTeamTabs } from "@/components/settings/SettingsTeamTabs";
import {
  MAX_VIDEO_PROCESSORS,
  listAllianceVideoProcessors,
  listVideoProcessorCandidates,
} from "@/lib/video/processor-slots.server";
import { canRefreshRosterFromAshed } from "@/lib/connect/ashed-shell-prompts.shared";
import { getDb, schema } from "@/lib/db";
import {
  assignableInviteRolesForContext,
  canManageTeamInvites,
} from "@/lib/native-alliance/team-invites.server";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { getRbacContext, sessionIsAllianceAdmin } from "@/lib/rbac/context";
import { getAllianceTeam } from "@/lib/rbac/sync-ashed-roles";
import {
  getAshedConnection,
  requirePageSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";
import { canRevokeOfficerAccess } from "@/lib/settings/team-officer-revoke.shared";
import {
  listOpenMemberRoleNudges,
  listTeamRoleHistory,
} from "@/lib/member-role-nudges/actions.server";
import { ALLIANCE_ADMIN_PERMISSION } from "@/lib/rbac/constants";

export const dynamic = "force-dynamic";

function canViewRoleNudges(rbac: {
  isPlatformMaintainer: boolean;
  roleName: string | null;
  permissions: Set<string>;
}): boolean {
  if (rbac.isPlatformMaintainer) return true;
  if (rbac.permissions.has(ALLIANCE_ADMIN_PERMISSION)) return true;
  return (
    rbac.roleName === "owner" ||
    rbac.roleName === "maintainer" ||
    rbac.roleName === "officer"
  );
}

export async function generateMetadata() {
  const t = await getTranslations("team");
  return await allianceScopedMetadata(t("title"));
}

export default async function SettingsTeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings/team");
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return <AllianceContextRequired alliances={access.pickAlliance} />;
  }

  const t = await getTranslations("team");
  if (access.allianceId === null) {
    redirect({ href: "/settings", locale });
    throw new Error("Alliance context required.");
  }
  const allianceId = access.allianceId;

  const team = await getAllianceTeam(allianceId);
  const rbac = await getRbacContext(access.session.id);
  const isAllianceAdmin = await sessionIsAllianceAdmin(access.session.id);
  const operatingMode = await getAllianceOperatingMode(allianceId);
  const ashedConnection = await getAshedConnection(access.session.id);
  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    access.session.id,
    access.session.hqUserId,
  );
  const canManageCredentialShares = Boolean(
    ashedConnection &&
      effectiveHqUserId &&
      (await sessionHoldsAshedIdentityForHqUser(
        access.session.id,
        effectiveHqUserId,
      )),
  );
  const canRefreshFromAshed =
    isAllianceAdmin &&
    canRefreshRosterFromAshed({
      operatingMode,
      isAshedConnected: ashedConnection !== null,
    });
  const canManageInvites = rbac ? canManageTeamInvites(rbac) : false;
  const canRevokeOfficers = rbac ? canRevokeOfficerAccess(rbac) : false;
  const assignableInviteRoles = rbac ? assignableInviteRolesForContext(rbac) : [];

  const [videoProcessors, videoProcessorCandidateList] = isAllianceAdmin
    ? await Promise.all([
        listAllianceVideoProcessors(allianceId),
        listVideoProcessorCandidates(allianceId),
      ])
    : [[], { candidates: [], eligibilityMode: "native_r4_r5" as const }];
  const videoProcessorIds = new Set(videoProcessors.map((p) => p.hqUserId));
  const availableVideoProcessorCandidates =
    videoProcessorCandidateList.candidates.filter(
      (c) => !videoProcessorIds.has(c.hqUserId),
    );

  let allianceTag = access.session.allianceTag;
  let allianceName: string | null = null;
  const db = getDb();
  const [alliance] = await db
    .select({
      tag: schema.alliances.tag,
      name: schema.alliances.name,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  allianceTag = alliance?.tag ?? allianceTag;
  allianceName = alliance?.name ?? null;

  const tagLabel = allianceTag ?? allianceName ?? t("unknownAlliance");

  const roleNudgesOpen =
    rbac && canViewRoleNudges(rbac)
      ? await listOpenMemberRoleNudges(allianceId, rbac)
      : [];
  const roleNudgesHistory =
    rbac && canViewRoleNudges(rbac)
      ? await listTeamRoleHistory(allianceId, 40)
      : [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-hq-accent hover:underline">
          ← {t("backToSettings")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">
          {t("titleWithTag", { tag: tagLabel })}
        </h1>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("description")}</p>
      </div>

      <SettingsTeamTabs
        canManageInvites={canManageInvites}
        isAllianceAdmin={isAllianceAdmin}
        assignableInviteRoles={assignableInviteRoles}
        allianceName={allianceName ?? tagLabel}
        videoProcessors={videoProcessors}
        videoProcessorCandidates={availableVideoProcessorCandidates}
        videoProcessorEligibilityMode={
          videoProcessorCandidateList.eligibilityMode
        }
        maxVideoProcessors={MAX_VIDEO_PROCESSORS}
        canManageCredentialShares={canManageCredentialShares}
        canRevokeOfficers={canRevokeOfficers}
        currentHqUserId={effectiveHqUserId}
        initialTeam={team}
        canRefreshFromAshed={canRefreshFromAshed}
        ashedNote={canRefreshFromAshed ? t("ashedNote") : null}
        roleNudgesOpen={roleNudgesOpen}
        roleNudgesHistory={roleNudgesHistory}
      />
    </div>
  );
}
