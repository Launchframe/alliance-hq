import { AllianceSettingsForm } from "@/components/AllianceSettingsForm";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
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

  return (
    <AllianceSettingsForm
      allianceTag={allianceTag}
      showTeamLink={showTeamLink}
    />
  );
}
