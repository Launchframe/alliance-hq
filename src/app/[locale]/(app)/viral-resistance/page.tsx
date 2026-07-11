import { getTranslations } from "next-intl/server";

import { ViralResistanceView } from "@/components/vr/ViralResistanceView";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { sessionHasPermission } from "@/lib/rbac/context";
import {
  loadViralResistanceLeaderboard,
  loadViralResistanceOfficerPanel,
} from "@/lib/vr/load-leaderboard";
import { requirePageSession } from "@/lib/session";
import type { VrProgressChartPayload } from "@/lib/vr/vr-progress-chart.shared";

export const dynamic = "force-dynamic";

const EMPTY_PROGRESS_CHART: VrProgressChartPayload = {
  seasonKey: "1",
  vrUpdatesLocked: false,
  series: [],
};

export async function generateMetadata() {
  const t = await getTranslations("viralResistance");
  return { title: t("title") };
}

export default async function ViralResistancePage() {
  const session = await requirePageSession("/viral-resistance");
  await requirePagePermission(session.id, "members:write", "/my-vr");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return (
      <ViralResistanceView
        initial={{
          seasonKey: "1",
          rows: [],
          progressChart: EMPTY_PROGRESS_CHART,
        }}
        officer={null}
      />
    );
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
