import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { VideoJobsConsolePage } from "@/components/video/VideoJobsConsolePage";
import { TOOLS_VIDEO_JOBS_CONSOLE } from "@/lib/video/video-jobs-console.shared";

export const dynamic = "force-dynamic";

export default async function ToolsVideoJobsPage() {
  const t = await getTranslations("toolsVideoJobs");

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-hq-fg">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        </div>
        <Link
          href="/tools/video-upload/queue"
          className="shrink-0 rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent transition-colors"
        >
          {t("backToQueue")} →
        </Link>
      </div>
      <VideoJobsConsolePage config={TOOLS_VIDEO_JOBS_CONSOLE} />
    </div>
  );
}
