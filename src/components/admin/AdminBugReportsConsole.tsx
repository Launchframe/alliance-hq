"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  AdminConsoleLogsBlock,
  AdminDetailField,
  AdminFeedbackDetailPanel,
  AdminFeedbackMasterDetail,
  AdminFeedbackTableShell,
  AdminMetadataBlock,
  AdminStatusPill,
} from "@/components/admin/AdminFeedbackUi";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/AppSelect";
import { ScreenshotLightbox } from "@/components/ui/ScreenshotLightbox";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import { BUG_REPORT_AREAS } from "@/lib/feedback/constants";

type BugReportSummary = {
  id: string;
  status: string;
  area: string | null;
  severity: number | null;
  subject: string | null;
  descriptionPreview: string;
  pageUrl: string | null;
  reporterLabel: string;
  screenshotCount: number;
  hasConsoleLogs: boolean;
  createdAt: string | null;
};

type BugReportDetail = {
  id: string;
  status: string;
  area: string | null;
  severity: number | null;
  subject: string | null;
  description: string;
  pageUrl: string | null;
  locale: string | null;
  allianceId: string | null;
  hqUserId: string | null;
  reporterLabel: string;
  appVersion: string | null;
  browserVersion: string | null;
  osVersion: string | null;
  consoleLogs: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  screenshots: Array<{
    id: string;
    width: number | null;
    height: number | null;
    url: string;
  }>;
};

const BUG_STATUSES = ["open", "triaged", "closed", "wontfix"] as const;

export function AdminBugReportsConsole() {
  const t = useTranslations("admin.bugReportsPage");
  const tAreas = useTranslations("feedback.bugReport.areas");
  const [reports, setReports] = useState<BugReportSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [areaFilter, setAreaFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BugReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [screenshotLightboxIndex, setScreenshotLightboxIndex] = useState<
    number | null
  >(null);

  async function loadList() {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (areaFilter !== "all") params.set("area", areaFilter);
    const qs = params.toString();
    const res = await fetch(`/api/admin/bug-reports${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { reports: BugReportSummary[] };
    setReports(data.reports);
    if (selectedId && !data.reports.some((row) => row.id === selectedId)) {
      setSelectedId(null);
      setDetail(null);
      setScreenshotLightboxIndex(null);
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/bug-reports/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { report: BugReportDetail };
      setDetail(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  const activeDetail =
    selectedId && detail?.id === selectedId ? detail : null;

  const screenshotSlides = useMemo(
    () => (activeDetail?.screenshots ?? []).map((shot) => ({ src: shot.url })),
    [activeDetail?.screenshots],
  );

  function selectReport(reportId: string) {
    setScreenshotLightboxIndex(null);
    setSelectedId(reportId);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadList();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, areaFilter, t]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void (async () => {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/admin/bug-reports/${selectedId}`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { report: BugReportDetail };
        if (!cancelled) {
          setDetail(data.report);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
          setDetail(null);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, t]);

  async function updateStatus(status: (typeof BUG_STATUSES)[number]) {
    if (!activeDetail || statusSaving) return;
    setError(null);
    setMessage(null);
    setStatusSaving(status);
    try {
      const res = await fetch(`/api/admin/bug-reports/${activeDetail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("saveFailed"));
      setMessage(t("saved"));
      await loadList();
      await loadDetail(activeDetail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setStatusSaving(null);
    }
  }

  function areaLabel(area: string | null) {
    if (!area) return "—";
    if (BUG_REPORT_AREAS.includes(area as (typeof BUG_REPORT_AREAS)[number])) {
      return tAreas(area as (typeof BUG_REPORT_AREAS)[number]);
    }
    return area;
  }

  function severityLabel(severity: number | null) {
    if (severity == null) return "—";
    const key = `severity${severity}` as "severity1" | "severity2" | "severity3" | "severity4";
    return t(key);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["open", t("filterOpen")],
            ["triaged", t("filterTriaged")],
            ["closed", t("filterClosed")],
            ["wontfix", t("filterWontfix")],
            ["all", t("filterAll")],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={statusFilter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <label className="block w-full min-w-0 text-sm sm:max-w-xs">
        <span className="text-hq-fg-muted">{t("filterArea")}</span>
        <AppSelect
          className="mt-1"
          value={areaFilter}
          onChange={setAreaFilter}
          aria-label={t("filterArea")}
          options={[
            { value: "all", label: t("filterAllAreas") },
            ...BUG_REPORT_AREAS.map((area) => ({
              value: area,
              label: tAreas(area),
            })),
          ]}
        />
      </label>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-hq-green">{message}</p> : null}

      <AdminFeedbackMasterDetail
        table={
          <ResponsiveRecordViews
            isEmpty={reports.length === 0}
            emptyMessage={t("empty")}
            mobileCards={reports.map((report) => (
              <RecordDetailCard
                key={report.id}
                selected={selectedId === report.id}
                onClick={() => selectReport(report.id)}
              >
                <RecordDetailField label={t("colTime")}>
                  {report.createdAt ? (
                    <FormattedDateTime value={report.createdAt} />
                  ) : (
                    "—"
                  )}
                </RecordDetailField>
                <RecordDetailField label={t("colSeverity")}>
                  {severityLabel(report.severity)}
                </RecordDetailField>
                <RecordDetailField label={t("colArea")}>
                  {areaLabel(report.area)}
                </RecordDetailField>
                <RecordDetailField label={t("colReporter")}>
                  <span className="wrap-break-word">{report.reporterLabel}</span>
                </RecordDetailField>
                <RecordDetailField label={t("colStatus")}>
                  <AdminStatusPill>{report.status}</AdminStatusPill>
                </RecordDetailField>
              </RecordDetailCard>
            ))}
            desktopTable={
              <AdminFeedbackTableShell>
                <thead className="bg-hq-surface text-hq-fg-muted">
                  <tr>
                    <th className="px-4 py-2">{t("colTime")}</th>
                    <th className="px-4 py-2">{t("colSeverity")}</th>
                    <th className="px-4 py-2">{t("colArea")}</th>
                    <th className="px-4 py-2">{t("colReporter")}</th>
                    <th className="px-4 py-2">{t("colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr
                      key={report.id}
                      className={`cursor-pointer border-t border-hq-border hover:bg-hq-surface-muted/60 ${selectedId === report.id ? "bg-hq-surface-muted" : ""}`}
                      onClick={() => selectReport(report.id)}
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-hq-fg-muted">
                        {report.createdAt ? (
                          <FormattedDateTime value={report.createdAt} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {severityLabel(report.severity)}
                      </td>
                      <td className="max-w-[10rem] truncate px-4 py-2">
                        {areaLabel(report.area)}
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-2">
                        {report.reporterLabel}
                      </td>
                      <td className="px-4 py-2">
                        <AdminStatusPill>{report.status}</AdminStatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminFeedbackTableShell>
            }
          />
        }
        detail={
          activeDetail || (selectedId && detailLoading) ? (
            <AdminFeedbackDetailPanel>
              {detailLoading && !activeDetail ? (
                <p className="text-sm text-hq-fg-muted">{t("loadingDetail")}</p>
              ) : activeDetail ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminStatusPill>{activeDetail.status}</AdminStatusPill>
                    {activeDetail.screenshots.length > 0 ? (
                      <AdminStatusPill>
                        {t("screenshotCount", {
                          count: activeDetail.screenshots.length,
                        })}
                      </AdminStatusPill>
                    ) : null}
                    {activeDetail.consoleLogs?.trim() ? (
                      <AdminStatusPill>{t("hasConsoleLogs")}</AdminStatusPill>
                    ) : null}
                  </div>

                  <AdminDetailField label={t("reporter")}>
                    {activeDetail.reporterLabel}
                  </AdminDetailField>

                  {activeDetail.subject ? (
                    <AdminDetailField label={t("subject")}>
                      {activeDetail.subject}
                    </AdminDetailField>
                  ) : null}

                  <AdminDetailField label={t("description")}>
                    <p className="whitespace-pre-wrap">{activeDetail.description}</p>
                  </AdminDetailField>

                  {activeDetail.pageUrl ? (
                    <AdminDetailField label={t("pageUrl")}>
                      <a
                        href={activeDetail.pageUrl}
                        className="break-all text-hq-accent hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {activeDetail.pageUrl}
                      </a>
                    </AdminDetailField>
                  ) : null}

                  <AdminMetadataBlock
                    items={[
                      { label: t("metaArea"), value: areaLabel(activeDetail.area) },
                      {
                        label: t("metaSeverity"),
                        value: severityLabel(activeDetail.severity),
                      },
                      { label: t("metaLocale"), value: activeDetail.locale ?? "—" },
                      {
                        label: t("metaAlliance"),
                        value: activeDetail.allianceId ?? "—",
                      },
                      {
                        label: t("metaAppVersion"),
                        value: activeDetail.appVersion ?? "—",
                      },
                      {
                        label: t("metaBrowser"),
                        value: activeDetail.browserVersion ?? "—",
                      },
                      { label: t("metaOs"), value: activeDetail.osVersion ?? "—" },
                    ]}
                  />

                  <AdminConsoleLogsBlock logs={activeDetail.consoleLogs} />

                  {activeDetail.screenshots.length > 0 ? (
                    <AdminDetailField label={t("screenshots")}>
                      <div className="flex flex-wrap gap-2">
                        {activeDetail.screenshots.map((shot, index) => (
                          <button
                            key={shot.id}
                            type="button"
                            className="overflow-hidden rounded border border-hq-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
                            onClick={() => setScreenshotLightboxIndex(index)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={shot.url}
                              alt=""
                              className="h-20 w-28 object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </AdminDetailField>
                  ) : null}

                  <div className="grid gap-2">
                    <p className="text-xs text-hq-fg-subtle">{t("updateStatus")}</p>
                    <div className="flex flex-wrap gap-2">
                      {BUG_STATUSES.map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={
                            activeDetail.status === status ? "default" : "outline"
                          }
                          disabled={!!statusSaving}
                          onClick={() => void updateStatus(status)}
                        >
                          {statusSaving === status
                            ? t("saving")
                            : t(`status.${status}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </AdminFeedbackDetailPanel>
          ) : (
            <AdminFeedbackDetailPanel>
              <p className="text-sm text-hq-fg-muted">{t("selectReport")}</p>
            </AdminFeedbackDetailPanel>
          )
        }
      />

      <ScreenshotLightbox
        open={
          screenshotLightboxIndex !== null &&
          activeDetail !== null &&
          screenshotLightboxIndex < screenshotSlides.length
        }
        index={screenshotLightboxIndex ?? 0}
        slides={screenshotSlides}
        onClose={() => setScreenshotLightboxIndex(null)}
        closeLabel={t("closePreview")}
      />
    </div>
  );
}
