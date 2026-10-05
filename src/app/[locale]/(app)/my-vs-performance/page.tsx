import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { MyVsPerformanceClient } from "@/components/vs-performance/MyVsPerformanceClient";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";
import { loadMyVsPerformance } from "@/lib/vs-performance/my-performance.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("myVsPerformance");
  return await allianceScopedMetadata(t("title"));
}

export default async function MyVsPerformancePage() {
  const session = await requirePageSession("/my-vs-performance");
  await requirePagePermission(session.id, "members:read", "/members");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    redirect("/get-started");
  }

  const initial = await loadMyVsPerformance(session.id, session.hqUserId, allianceId, {});

  return (
    <div className="px-4 py-6 md:px-0">
      <MyVsPerformanceClient initial={initial} />
    </div>
  );
}
