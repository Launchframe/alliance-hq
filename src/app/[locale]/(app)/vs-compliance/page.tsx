import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { VsComplianceClient } from "@/components/vs-compliance/VsComplianceClient";
import { vsComplianceTaskKindForStrike } from "@/lib/vs-compliance/evaluate.shared";
import { listOpenVsComplianceEvents } from "@/lib/vs-compliance/repository.server";
import { loadVsMembershipSettings } from "@/lib/vs-compliance/vs-membership-settings.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("vsCompliance");
  return { title: t("title") };
}

export default async function VsCompliancePage() {
  const session = await requirePageSession("/vs-compliance");
  await requirePagePermission(session.id, "members:write", "/time-off");

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    notFound();
  }

  const [events, settings] = await Promise.all([
    listOpenVsComplianceEvents(allianceId),
    loadVsMembershipSettings(allianceId, false),
  ]);

  return (
    <VsComplianceClient
      initialEvents={events.map((event) => ({
        ...event,
        taskKind: vsComplianceTaskKindForStrike(
          event.strikeNumber ?? 1,
          settings.missStrikesBeforeKick,
        ),
      }))}
    />
  );
}
