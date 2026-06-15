"use client";

import { useEffect, useState } from "react";
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
  const [expandedScreenshotUrl, setExpandedScreenshotUrl] = useState<
    string | null
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
    if (!activeDetail) return;
    setError(null);
    setMessage(null);
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
        <p className="text-sm text-[#8b949e]">{t("subtitle")}</p>
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

      <label className="block max-w-xs text-sm">
        <span className="text-[#8b949e]">{t("filterArea")}</span>
        <select
          className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
        >
          <option value="all">{t("filterAllAreas")}</option>
          {BUG_REPORT_AREAS.map((area) => (
            <option key={area} value={area}>
              {tAreas(area)}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}

      <AdminFeedbackMasterDetail
        table={
          <AdminFeedbackTableShell>
            <thead className="bg-[#161b22] text-[#8b949e]">
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
                  className={`cursor-pointer border-t border-[#30363d] hover:bg-[#21262d]/60 ${selectedId === report.id ? "bg-[#21262d]" : ""}`}
                  onClick={() => setSelectedId(report.id)}
                >
                  <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                    {report.createdAt ? (
                      <FormattedDateTime value={report.createdAt} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2">{severityLabel(report.severity)}</td>
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
        detail={
          activeDetail || (selectedId && detailLoading) ? (
            <AdminFeedbackDetailPanel>
              {detailLoading && !activeDetail ? (
                <p className="text-sm text-[#8b949e]">{t("loadingDetail")}</p>
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
                        className="break-all text-[#58a6ff] hover:underline"
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
                        {activeDetail.screenshots.map((shot) => (
                          <button
                            key={shot.id}
                            type="button"
                            className="overflow-hidden rounded border border-[#30363d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
                            onClick={() => setExpandedScreenshotUrl(shot.url)}
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
                    <p className="text-xs text-[#6e7681]">{t("updateStatus")}</p>
                    <div className="flex flex-wrap gap-2">
                      {BUG_STATUSES.map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={
                            activeDetail.status === status ? "default" : "outline"
                          }
                          onClick={() => void updateStatus(status)}
                        >
                          {t(`status.${status}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </AdminFeedbackDetailPanel>
          ) : (
            <AdminFeedbackDetailPanel>
              <p className="text-sm text-[#8b949e]">{t("selectReport")}</p>
            </AdminFeedbackDetailPanel>
          )
        }
      />

      {expandedScreenshotUrl ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("screenshotPreview")}
          onClick={() => setExpandedScreenshotUrl(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full border border-white/30 px-3 py-1 text-sm text-white"
            onClick={() => setExpandedScreenshotUrl(null)}
          >
            {t("closePreview")}
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expandedScreenshotUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
