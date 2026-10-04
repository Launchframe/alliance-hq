import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { requirePageSession } from "@/lib/session";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { supportSnapshot } from "@/lib/support-teams/service.server";
import { readDisplayPreferences } from "@/lib/support-teams/display-preferences.server";
import { resolveTeamInviteAccess } from "@/lib/native-alliance/team-invites.server";
import { SupportTeamClient } from "@/components/support-teams/SupportTeamClient";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("supportTeams");
  return allianceScopedMetadata(t("title"));
}
export default async function SupportTeamsPage() {
  const session = await requirePageSession("/support-teams");
  const access = await requireSupportAccess().catch(() => null);
  if (!access) notFound();
  const [initial, initialPreferences, inviteAccess] = await Promise.all([
    supportSnapshot(access),
    readDisplayPreferences(access.actor.principalId),
    resolveTeamInviteAccess(session.id),
  ]);
  const canInvite = !(inviteAccess instanceof NextResponse) && inviteAccess.allianceId === access.actor.allianceId && inviteAccess.assignableRoles.includes("member");
  return <SupportTeamClient key={`${access.actor.allianceId}:${access.actor.principalId}`} initial={initial} initialPreferences={initialPreferences} canInvite={canInvite} />;
}
