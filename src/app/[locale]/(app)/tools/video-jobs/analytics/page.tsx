import { getTranslations } from "next-intl/server";

import { AdminVideoAnalyticsView } from "@/app/[locale]/(app)/admin/video-jobs/analytics/AdminVideoAnalyticsView";
import { TOOLS_VIDEO_JOBS_CONSOLE } from "@/lib/video/video-jobs-console.shared";

export const dynamic = "force-dynamic";

export default async function ToolsVideoJobsAnalyticsPage() {
  const t = await getTranslations("toolsVideoJobs");

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-hq-fg">{t("analyticsTitle")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("analyticsSubtitle")}</p>
      </div>
      <AdminVideoAnalyticsView config={TOOLS_VIDEO_JOBS_CONSOLE} />
    </div>
  );
}
