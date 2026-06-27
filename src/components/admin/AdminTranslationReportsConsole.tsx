"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  AdminDetailField,
  AdminFeedbackDetailPanel,
  AdminFeedbackMasterDetail,
  AdminFeedbackTableShell,
  AdminStatusPill,
} from "@/components/admin/AdminFeedbackUi";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Button } from "@/components/ui/button";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import { Textarea } from "@/components/ui/textarea";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type Report = {
  id: string;
  locale: string;
  i18nKey: string | null;
  candidateKeys: string[];
  displayedText: string;
  suggestedTranslation: string;
  pagePath: string | null;
  status: string;
  hqUserId: string;
  reporterLabel: string;
  reviewedBy: string | null;
  reviewerLabel: string;
  reviewedAt: string | null;
  createdAt: string | null;
  adminNotes: string | null;
};

export function AdminTranslationReportsConsole() {
  const t = useTranslations("adminTranslationReports");
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<string>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  async function load(status?: string) {
    const query = status && status !== "all" ? `?status=${status}` : "";
    const res = await fetch(`/api/admin/translation-reports${query}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { reports: Report[] };
    setReports(data.reports);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load(filter);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, t]);

  async function updateStatus(status: "applied" | "dismissed") {
    if (!selected) return;
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/translation-reports/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNotes: notes || undefined }),
      });
      const data = (await res.json()) as {
        error?: string;
        commendations?: { awarded?: string[] };
        localePatch?: {
          locale: string;
          i18nKey: string;
          newValue: string;
        };
      };
      if (!res.ok) throw new Error(data.error ?? t("saveFailed"));
      const parts: string[] = [];
      if (data.localePatch) {
        parts.push(
          t("localePatched", {
            locale: data.localePatch.locale,
            key: data.localePatch.i18nKey,
            value: data.localePatch.newValue,
          }),
        );
      }
      if (data.commendations?.awarded?.length) {
        parts.push(
          t("awarded", { badges: data.commendations.awarded.join(", ") }),
        );
      }
      setMessage(parts.length > 0 ? parts.join(" ") : t("saved"));
      await load(filter);
      setSelectedId(null);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    }
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
            ["pending", t("filterPending")],
            ["applied", t("filterApplied")],
            ["dismissed", t("filterDismissed")],
            ["all", t("filterAll")],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={filter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}

      <AdminFeedbackMasterDetail
        table={
          <ResponsiveRecordViews
            isEmpty={reports.length === 0}
            emptyMessage={t("empty")}
            mobileCards={reports.map((report) => (
              <RecordDetailCard
                key={report.id}
                selected={selectedId === report.id}
                onClick={() => {
                  setSelectedId(report.id);
                  setNotes(report.adminNotes ?? "");
                }}
              >
                <RecordDetailField label={t("colTime")}>
                  {report.createdAt ? (
                    <FormattedDateTime value={report.createdAt} />
                  ) : (
                    "—"
                  )}
                </RecordDetailField>
                <RecordDetailField label={t("colLocale")}>
                  {report.locale}
                </RecordDetailField>
                <RecordDetailField
                  label={t("colKey")}
                  valueClassName="font-mono text-sm"
                >
                  <span className="wrap-break-word">
                    {report.i18nKey ?? report.displayedText}
                  </span>
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
                <thead className="bg-[#161b22] text-[#8b949e]">
                  <tr>
                    <th className="px-4 py-2">{t("colTime")}</th>
                    <th className="px-4 py-2">{t("colLocale")}</th>
                    <th className="px-4 py-2">{t("colKey")}</th>
                    <th className="px-4 py-2">{t("colReporter")}</th>
                    <th className="px-4 py-2">{t("colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr
                      key={report.id}
                      className={`cursor-pointer border-t border-[#30363d] hover:bg-[#21262d]/60 ${selectedId === report.id ? "bg-[#21262d]" : ""}`}
                      onClick={() => {
                        setSelectedId(report.id);
                        setNotes(report.adminNotes ?? "");
                      }}
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                        {report.createdAt ? (
                          <FormattedDateTime value={report.createdAt} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2">{report.locale}</td>
                      <td className="max-w-xs truncate px-4 py-2 font-mono text-xs">
                        {report.i18nKey ?? report.displayedText}
                      </td>
                      <td className="max-w-[10rem] truncate px-4 py-2">
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
          selected ? (
            <AdminFeedbackDetailPanel>
              <AdminStatusPill>{selected.status}</AdminStatusPill>

              <AdminDetailField label={t("reporter")}>
                {selected.reporterLabel}
              </AdminDetailField>

              {selected.pagePath ? (
                <AdminDetailField label={t("pagePath")}>
                  <span className="break-all font-mono text-xs">
                    {selected.pagePath}
                  </span>
                </AdminDetailField>
              ) : null}

              {selected.i18nKey ? (
                <AdminDetailField label={t("i18nKey")}>
                  <span className="break-all font-mono text-xs">
                    {selected.i18nKey}
                  </span>
                </AdminDetailField>
              ) : null}

              {selected.candidateKeys.length > 1 ? (
                <AdminDetailField label={t("candidateKeys")}>
                  <ul className="list-inside list-disc space-y-1 font-mono text-xs">
                    {selected.candidateKeys.map((key) => (
                      <li key={key} className="break-all">
                        {key}
                      </li>
                    ))}
                  </ul>
                </AdminDetailField>
              ) : null}

              <div className="grid gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div>
                  <p className="text-xs text-[#6e7681]">{t("displayed")}</p>
                  <p className="mt-1 text-sm">{selected.displayedText}</p>
                </div>
                <div className="border-t border-[#30363d] pt-3">
                  <p className="text-xs text-[#6e7681]">{t("suggested")}</p>
                  <p className="mt-1 text-sm text-[#3fb950]">
                    {selected.suggestedTranslation}
                  </p>
                </div>
              </div>

              {selected.reviewedAt ? (
                <AdminDetailField label={t("reviewed")}>
                  {selected.reviewerLabel !== "—"
                    ? `${selected.reviewerLabel} · `
                    : ""}
                  <FormattedDateTime value={selected.reviewedAt} />
                </AdminDetailField>
              ) : null}

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  preventDefaultFormSubmit(event);
                  void updateStatus("applied");
                }}
              >
              <label className="block space-y-1 text-sm">
                <span className="text-[#8b949e]">{t("adminNotes")}</span>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                  onKeyDown={(e) =>
                    handleTextareaEnterSubmit(e, () => {
                      void updateStatus("applied");
                    })
                  }
                  rows={3}
                />
              </label>

              {selected.status === "pending" ? (
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1">
                    {t("apply")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => void updateStatus("dismissed")}
                  >
                    {t("dismiss")}
                  </Button>
                </div>
              ) : null}
              </form>
            </AdminFeedbackDetailPanel>
          ) : (
            <AdminFeedbackDetailPanel>
              <p className="text-sm text-[#8b949e]">{t("selectReport")}</p>
            </AdminFeedbackDetailPanel>
          )
        }
      />
    </div>
  );
}
