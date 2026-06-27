import { AllianceSettingsForm } from "@/components/AllianceSettingsForm";
import { AllianceSettingsSetupGuideSection } from "@/components/settings/AllianceSettingsSetupGuideSection";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { buildAllianceSetupStatusPayload } from "@/lib/alliance-setup-guide-status-api";
import { requireAllianceSettingsSession, resolveAllianceTagForSession, shouldShowTeamAccessNavForSession } from "@/lib/settings/alliance-settings-access.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings");
  const access = await requireAllianceSettingsSession(session, locale);

  if ("pickAlliance" in access) {
    return <AllianceContextRequired alliances={access.pickAlliance} />;
  }

  const allianceTag = await resolveAllianceTagForSession(access.session);
  const showTeamLink = await shouldShowTeamAccessNavForSession(access.session);
  const setupGuide =
    access.session.hqUserId && access.session.currentAllianceId
      ? await buildAllianceSetupStatusPayload({
          allianceId: access.session.currentAllianceId,
          hqUserId: access.session.hqUserId,
          sessionId: access.session.id,
        })
      : null;

  return (
    <div className="mx-auto max-w-lg space-y-6 min-w-0 w-full">
      <AllianceSettingsSetupGuideSection initial={setupGuide} />
      <AllianceSettingsForm
        allianceTag={allianceTag}
        showTeamLink={showTeamLink}
      />
    </div>
  );
}
