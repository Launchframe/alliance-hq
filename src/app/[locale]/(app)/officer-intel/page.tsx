import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { OfficerIntelClient } from "@/components/officer-intel/OfficerIntelClient";
import { loadOfficerIntelDashboard } from "@/lib/officer-intel/load-dashboard.server";
import { OFFICER_INTEL_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("officerIntel");
  return { title: t("title") };
}

export default async function OfficerIntelPage() {
  const session = await requirePageSession("/officer-intel");
  await requirePagePermission(session.id, OFFICER_INTEL_READ_PERMISSION);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();

  const dashboard = await loadOfficerIntelDashboard(session.id, allianceId);
  if (!dashboard) notFound();

  return <OfficerIntelClient initial={dashboard} />;
}
