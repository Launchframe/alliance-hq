"use client";

import { useTranslations } from "next-intl";

import { ScreenshotOcrInspectorPanel } from "@/components/admin/ScreenshotOcrInspectorPanel";
import { Link } from "@/i18n/navigation";
import { screenshotOcrJobsListHref } from "@/lib/admin/screenshot-ocr-jobs.shared";

type Props = {
  jobId: string;
};

export function AdminScreenshotJobDetailView({ jobId }: Props) {
  const t = useTranslations("admin.screenshotJobsPage");

  return (
    <div className="space-y-4">
      <Link
        href={screenshotOcrJobsListHref()}
        className="text-sm text-hq-accent hover:underline"
      >
        {t("backToList")}
      </Link>
      <ScreenshotOcrInspectorPanel jobId={jobId} />
    </div>
  );
}
