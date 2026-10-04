import { getTranslations, getLocale } from "next-intl/server";

import { VsPerformanceClient } from "@/components/vs-performance/VsPerformanceClient";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { getSessionStateFor, requirePageSession } from "@/lib/session";
import { getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { getScoreTargetIdForNavHref } from "@/lib/video/score-target-nav";
import { isVsCalendarDate } from "@/lib/vs-performance/weekly-plan.shared";
import { loadVsPerformanceWeek } from "@/lib/vs-performance/weekly-plan.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return await allianceScopedMetadata(t("vsPerformance"));
}

type Props = {
  searchParams: Promise<{ week?: string }>;
};

export default async function VsPerformancePage({ searchParams }: Props) {
  const session = await requirePageSession("/vs-performance");
  await requirePagePermission(session.id, "scores:read", "/members");
  const locale = await getLocale();
  const state = await getSessionStateFor(session, locale);

  const { week } = await searchParams;
  const weekStart = getWeekStartMonday(
    week && isVsCalendarDate(week) ? week : getServerCalendarDate(),
  );
  const initial = await loadVsPerformanceWeek(session.id, weekStart);

  return (
    <div className="px-4 py-6 md:px-0">
      <VsPerformanceClient
        initial={initial}
        canUseAshedEmbeds={state.canUseAshedEmbeds}
        scoreTargetId={getScoreTargetIdForNavHref("/vs-performance")}
      />
    </div>
  );
}
