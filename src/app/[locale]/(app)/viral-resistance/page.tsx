import { getTranslations } from "next-intl/server";

import { ViralResistanceView } from "@/components/vr/ViralResistanceView";
import { sessionHasPermission } from "@/lib/rbac/context";
import {
  loadViralResistanceLeaderboard,
  loadViralResistanceOfficerPanel,
} from "@/lib/vr/load-leaderboard";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("viralResistance");
  return { title: t("title") };
}

export default async function ViralResistancePage() {
  const session = await requirePageSession("/viral-resistance");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return <ViralResistanceView initial={{ seasonKey: "1", rows: [] }} officer={null} />;
  }

  const initial = await loadViralResistanceLeaderboard(allianceId);
  const canOfficer = await sessionHasPermission(session.id, "members:write");
  const officer = canOfficer
    ? await loadViralResistanceOfficerPanel(allianceId)
    : null;

  return (
    <ViralResistanceView
      initial={initial}
      officer={officer}
      showMyVrCta={canOfficer}
    />
  );
}
