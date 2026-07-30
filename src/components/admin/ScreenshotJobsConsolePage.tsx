"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import { Link, useRouter } from "@/i18n/navigation";
import {
  SCREENSHOT_OCR_FAILURE_LABELS,
  SCREENSHOT_OCR_JOB_SOURCES,
  type ScreenshotOcrJobListItem,
  formatScreenshotOcrSource,
  screenshotOcrJobDetailHref,
  screenshotOcrJobsListHref,
} from "@/lib/admin/screenshot-ocr-jobs.shared";

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

function ParsedOkBadge({
  parsedOk,
  yesLabel,
  noLabel,
}: {
  parsedOk: boolean;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <span
      className={
        parsedOk
          ? "rounded-full border border-hq-green/40 bg-[#3fb95010] px-2 py-0.5 text-xs text-hq-green"
          : "rounded-full border border-hq-danger/40 bg-[#f8514910] px-2 py-0.5 text-xs text-hq-danger"
      }
    >
      {parsedOk ? yesLabel : noLabel}
    </span>
  );
}

function FailureSummary({ codes }: { codes: ScreenshotOcrJobListItem["failureCodes"] }) {
  if (codes.length === 0) return <span className="text-hq-fg-muted">—</span>;
  return (
    <span className="text-xs text-hq-fg-muted">
      {codes
        .slice(0, 2)
        .map((code) => SCREENSHOT_OCR_FAILURE_LABELS[code] ?? code)
        .join(", ")}
      {codes.length > 2 ? ` +${codes.length - 2}` : ""}
    </span>
  );
}

export function ScreenshotJobsConsolePage() {
  const t = useTranslations("admin");
  const tJobs = useTranslations("admin.screenshotJobsPage");
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceFilter = searchParams.get("source") ?? "all";
  const parsedOkFilter = searchParams.get("parsedOk") ?? "all";

  const [jobs, setJobs] = useState<ScreenshotOcrJobListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const setFilters = useCallback(
    (patch: { source?: string; parsedOk?: string }) => {
      router.replace(
        screenshotOcrJobsListHref({
          source: patch.source ?? sourceFilter,
          parsedOk: patch.parsedOk ?? parsedOkFilter,
        }),
        { scroll: false },
      );
    },
    [router, sourceFilter, parsedOkFilter],
  );

  const loadJobs = useCallback(async () => {
    const params = new URLSearchParams({ limit: "100" });
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (parsedOkFilter === "true" || parsedOkFilter === "false") {
      params.set("parsedOk", parsedOkFilter);
    }
    const res = await fetch(`/api/admin/screenshot-jobs?${params.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as {
      jobs: ScreenshotOcrJobListItem[];
      total: number;
    };
    return data;
  }, [sourceFilter, parsedOkFilter]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setListLoading(true);
      try {
        const data = await loadJobs();
        if (!cancelled) {
          setJobs(data.jobs);
          setTotal(data.total);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : tJobs("loadFailed"));
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadJobs, tJobs]);

  const empty = jobs.length === 0;
  const summary = useMemo(
    () => tJobs("resultCount", { shown: jobs.length, total }),
    [jobs.length, total, tJobs],
  );

  if (error && jobs.length === 0) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{tJobs("title")}</h2>
        <p className="text-sm text-hq-fg-muted">{tJobs("subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-hq-fg-muted">{tJobs("sourceFilter")}</label>
          <select
            value={sourceFilter}
            onChange={(event) => setFilters({ source: event.target.value })}
            className="rounded-lg border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg"
          >
            <option value="all">{tJobs("allSources")}</option>
            {SCREENSHOT_OCR_JOB_SOURCES.map((source) => (
              <option key={source} value={source}>
                {formatScreenshotOcrSource(source)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-hq-fg-muted">{tJobs("parsedOkFilter")}</label>
          <select
            value={parsedOkFilter}
            onChange={(event) => setFilters({ parsedOk: event.target.value })}
            className="rounded-lg border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg"
          >
            <option value="all">{tJobs("allParsedOk")}</option>
            <option value="true">{tJobs("parsedOkYes")}</option>
            <option value="false">{tJobs("parsedOkNo")}</option>
          </select>
        </div>
        <p className="ml-auto text-xs text-hq-fg-muted">{summary}</p>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="relative min-h-[12rem]">
        {listLoading ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-hq-canvas/70 text-sm text-hq-fg-muted"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin text-hq-accent" aria-hidden />
            {tJobs("listLoading")}
          </div>
        ) : null}
        <div className={listLoading ? "pointer-events-none opacity-50" : undefined}>
          <ResponsiveRecordViews
            isEmpty={empty}
            emptyMessage={tJobs("empty")}
            mobileCards={jobs.map((job) => (
              <RecordDetailCard key={job.id}>
                <RecordDetailField label={t("table.time")}>
                  {job.createdAt ? (
                    <FormattedDateTime value={job.createdAt} />
                  ) : (
                    "—"
                  )}
                </RecordDetailField>
                <RecordDetailField label={tJobs("colSource")}>
                  {formatScreenshotOcrSource(job.source)}
                </RecordDetailField>
                <RecordDetailField label={tJobs("colParsedOk")}>
                  <ParsedOkBadge
                    parsedOk={job.parsedOk}
                    yesLabel={t("yes")}
                    noLabel={t("no")}
                  />
                </RecordDetailField>
                <RecordDetailField label={tJobs("colPaired")}>
                  {job.pairedCount} / {job.expectedPairCount}
                </RecordDetailField>
                <RecordDetailField label={tJobs("colHeaderTotal")}>
                  {formatNumber(job.headerTotal)}
                </RecordDetailField>
                <RecordDetailField label={tJobs("colFailures")}>
                  <FailureSummary codes={job.failureCodes} />
                </RecordDetailField>
                <RecordDetailField label={tJobs("colTotalTime")}>
                  {formatMs(job.totalMs)}
                </RecordDetailField>
                <RecordDetailField label={tJobs("actions")}>
                  <Link
                    href={screenshotOcrJobDetailHref(job.id)}
                    className="text-sm text-hq-accent hover:underline"
                  >
                    {tJobs("inspect")}
                  </Link>
                </RecordDetailField>
              </RecordDetailCard>
            ))}
            desktopTable={
              <div className="overflow-x-auto rounded-xl border border-hq-border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-hq-surface text-hq-fg-muted">
                    <tr>
                      <th className="px-3 py-2">{t("table.time")}</th>
                      <th className="px-3 py-2">{tJobs("colSource")}</th>
                      <th className="px-3 py-2">{tJobs("colParsedOk")}</th>
                      <th className="px-3 py-2">{tJobs("colPaired")}</th>
                      <th className="px-3 py-2">{tJobs("colHeaderTotal")}</th>
                      <th className="px-3 py-2">{tJobs("colFailures")}</th>
                      <th className="px-3 py-2">{tJobs("colLayout")}</th>
                      <th className="px-3 py-2">{tJobs("colTotalTime")}</th>
                      <th className="px-3 py-2">{tJobs("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} className="border-t border-hq-border">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {job.createdAt ? (
                            <FormattedDateTime value={job.createdAt} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {formatScreenshotOcrSource(job.source)}
                        </td>
                        <td className="px-3 py-2">
                          <ParsedOkBadge
                            parsedOk={job.parsedOk}
                            yesLabel={t("yes")}
                            noLabel={t("no")}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {job.pairedCount} / {job.expectedPairCount}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {formatNumber(job.headerTotal)}
                        </td>
                        <td className="px-3 py-2">
                          <FailureSummary codes={job.failureCodes} />
                        </td>
                        <td className="px-3 py-2 text-xs">{job.layoutClass}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {formatMs(job.totalMs)}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={screenshotOcrJobDetailHref(job.id)}
                            className="text-hq-accent hover:underline"
                          >
                            {tJobs("inspect")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
