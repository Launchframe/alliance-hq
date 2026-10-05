import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { VsMemberDetailClient } from "@/components/vs-performance/VsMemberDetailClient";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";
import { getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { isVsCalendarDate } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return await allianceScopedMetadata(t("vsPerformance"));
}

type Props = {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ week?: string }>;
};

export default async function VsMemberDetailPage({ params, searchParams }: Props) {
  const session = await requirePageSession("/vs-performance");
  await requirePagePermission(session.id, "scores:read", "/members");
  await getLocale();
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();
  try {
    await requireVsComplianceAccess(session.id, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  } catch (error) {
    if (error instanceof VsComplianceError && error.code === "forbidden") notFound();
    throw error;
  }

  const { memberId } = await params;
  const { week } = await searchParams;
  const weekStart = getWeekStartMonday(
    week && isVsCalendarDate(week) ? week : getServerCalendarDate(),
  );

  return (
    <div className="px-4 py-6 md:px-0">
      <VsMemberDetailClient memberId={memberId} weekStart={weekStart} />
    </div>
  );
}
