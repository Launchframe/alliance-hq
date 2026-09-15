import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePageSession } from "@/lib/session";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { loadTeamWorkDashboard } from "@/lib/support-teams/work-service.server";
import { SupportError } from "@/lib/support-teams/types.shared";
import { TeamWorkClient } from "@/components/support-teams/TeamWorkClient";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("teamWork");
  return allianceScopedMetadata(t("title"));
}
export default async function TeamWorkPage() {
  await requirePageSession("/team-work");
  const access = await requireSupportAccess().catch(() => null);
  if (!access) notFound();
  let initial;
  try {
    initial = await loadTeamWorkDashboard({ sessionId: access.sessionId, hqUserId: access.actor.principalId, allianceId: access.actor.allianceId }, { personal: false });
  } catch (error) {
    if (error instanceof SupportError) notFound();
    throw error;
  }
  return <TeamWorkClient initial={initial} />;
}
