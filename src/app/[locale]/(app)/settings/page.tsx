import { redirect } from "@/i18n/navigation";

import { AllianceSettingsForm } from "@/components/AllianceSettingsForm";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { sessionHasActiveMembership } from "@/lib/native-alliance/access";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/settings");
  const hasMembership = await sessionHasActiveMembership(session);

  if (!hasMembership) {
    redirect({ href: "/account", locale });
  }

  const allianceId = resolveSessionAllianceId(session);

  return (
    <AllianceSettingsForm
      allianceTag={session.allianceTag}
      showTeamLink={Boolean(allianceId)}
    />
  );
}
