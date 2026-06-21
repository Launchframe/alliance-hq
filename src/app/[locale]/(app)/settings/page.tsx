import { AllianceSettingsForm } from "@/components/AllianceSettingsForm";
import { AllianceContextRequired } from "@/components/settings/AllianceContextRequired";
import { requireAllianceSettingsSession, resolveAllianceTagForSession } from "@/lib/settings/alliance-settings-access.server";
import { sessionHasActiveMembership } from "@/lib/native-alliance/access";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
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

  const hasMembership = await sessionHasActiveMembership(access.session);
  const allianceId = resolveSessionAllianceId(access.session);
  const allianceTag = await resolveAllianceTagForSession(access.session);

  return (
    <AllianceSettingsForm
      allianceTag={allianceTag}
      showTeamLink={hasMembership && Boolean(allianceId)}
    />
  );
}
