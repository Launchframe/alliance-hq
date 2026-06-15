"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  AdminDetailField,
  AdminFeedbackDetailPanel,
  AdminFeedbackMasterDetail,
  AdminFeedbackTableShell,
  AdminMetadataBlock,
  AdminStatusPill,
} from "@/components/admin/AdminFeedbackUi";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Button } from "@/components/ui/button";
import {
  RecordDetailCard,
  RecordDetailField,
  ResponsiveRecordViews,
} from "@/components/ui/ResponsiveRecordViews";
import { Link } from "@/i18n/navigation";

type SurveyFeedbackRow = {
  id: string;
  source: string;
  positiveExperience: boolean | null;
  feedback: string | null;
  outreachConsent: boolean;
  isComplete: boolean;
  dismissedAt: string | null;
  videoJobId: string | null;
  pagePath: string | null;
  locale: string | null;
  allianceId: string | null;
  reporterLabel: string;
  appVersion: string | null;
  browserVersion: string | null;
  osVersion: string | null;
  createdAt: string | null;
};

export function AdminSurveyFeedbackConsole() {
  const t = useTranslations("admin.experienceFeedbackPage");
  const tAdmin = useTranslations("admin");
  const [rows, setRows] = useState<SurveyFeedbackRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [completeFilter, setCompleteFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  async function load() {
    const params = new URLSearchParams();
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (sentimentFilter !== "all") params.set("sentiment", sentimentFilter);
    if (completeFilter !== "all") params.set("complete", completeFilter);
    const qs = params.toString();
    const res = await fetch(
      `/api/admin/survey-feedback${qs ? `?${qs}` : ""}`,
    );
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { feedback: SurveyFeedbackRow[] };
    setRows(data.feedback);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceFilter, sentimentFilter, completeFilter, t]);

  function sourceLabel(source: string) {
    if (source === "solicited_first_upload") return t("sourceFirstUpload");
    if (source === "solicited_third_upload") return t("sourceThirdUpload");
    if (source === "unsolicited") return t("sourceUnsolicited");
    return source;
  }

  function sentimentLabel(value: boolean | null) {
    if (value === true) return t("sentimentPositive");
    if (value === false) return t("sentimentNegative");
    return t("sentimentUnknown");
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
            ["all", t("filterAllSources")],
            ["unsolicited", t("sourceUnsolicited")],
            ["solicited_first_upload", t("sourceFirstUpload")],
            ["solicited_third_upload", t("sourceThirdUpload")],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={sourceFilter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setSourceFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", t("filterAllSentiment")],
            ["positive", t("sentimentPositive")],
            ["negative", t("sentimentNegative")],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={sentimentFilter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setSentimentFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", t("filterAllCompletion")],
            ["complete", t("filterComplete")],
            ["incomplete", t("filterIncomplete")],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={completeFilter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setCompleteFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <AdminFeedbackMasterDetail
        table={
          <ResponsiveRecordViews
            isEmpty={rows.length === 0}
            emptyMessage={t("empty")}
            mobileCards={rows.map((row) => (
              <RecordDetailCard
                key={row.id}
                selected={selectedId === row.id}
                onClick={() => setSelectedId(row.id)}
              >
                <RecordDetailField label={t("colTime")}>
                  {row.createdAt ? (
                    <FormattedDateTime value={row.createdAt} />
                  ) : (
                    "—"
                  )}
                </RecordDetailField>
                <RecordDetailField label={t("colSource")}>
                  {sourceLabel(row.source)}
                </RecordDetailField>
                <RecordDetailField label={t("colSentiment")}>
                  {sentimentLabel(row.positiveExperience)}
                </RecordDetailField>
                <RecordDetailField label={t("colReporter")}>
                  <span className="wrap-break-word">{row.reporterLabel}</span>
                </RecordDetailField>
              </RecordDetailCard>
            ))}
            desktopTable={
              <AdminFeedbackTableShell>
                <thead className="bg-[#161b22] text-[#8b949e]">
                  <tr>
                    <th className="px-4 py-2">{t("colTime")}</th>
                    <th className="px-4 py-2">{t("colSource")}</th>
                    <th className="px-4 py-2">{t("colSentiment")}</th>
                    <th className="px-4 py-2">{t("colReporter")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer border-t border-[#30363d] hover:bg-[#21262d]/60 ${selectedId === row.id ? "bg-[#21262d]" : ""}`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-[#8b949e]">
                        {row.createdAt ? (
                          <FormattedDateTime value={row.createdAt} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2">{sourceLabel(row.source)}</td>
                      <td className="px-4 py-2">
                        {sentimentLabel(row.positiveExperience)}
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-2">
                        {row.reporterLabel}
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
              <div className="flex flex-wrap gap-2">
                <AdminStatusPill>{sourceLabel(selected.source)}</AdminStatusPill>
                <AdminStatusPill>
                  {sentimentLabel(selected.positiveExperience)}
                </AdminStatusPill>
                {selected.isComplete ? (
                  <AdminStatusPill>{t("complete")}</AdminStatusPill>
                ) : null}
                {selected.dismissedAt ? (
                  <AdminStatusPill>{t("dismissed")}</AdminStatusPill>
                ) : null}
              </div>

              <AdminDetailField label={t("reporter")}>
                {selected.reporterLabel}
              </AdminDetailField>

              <AdminDetailField label={t("feedbackText")}>
                <p className="whitespace-pre-wrap">
                  {selected.feedback?.trim() ? selected.feedback : t("noFeedbackText")}
                </p>
              </AdminDetailField>

              <AdminDetailField label={t("outreachConsent")}>
                {selected.outreachConsent ? tAdmin("yes") : tAdmin("no")}
              </AdminDetailField>

              {selected.pagePath ? (
                <AdminDetailField label={t("pagePath")}>
                  <span className="break-all font-mono text-xs">
                    {selected.pagePath}
                  </span>
                </AdminDetailField>
              ) : null}

              {selected.videoJobId ? (
                <AdminDetailField label={t("videoJob")}>
                  <Link
                    href="/admin/video-jobs"
                    className="text-[#58a6ff] hover:underline"
                  >
                    {selected.videoJobId}
                  </Link>
                </AdminDetailField>
              ) : null}

              <AdminMetadataBlock
                items={[
                  { label: t("metaLocale"), value: selected.locale ?? "—" },
                  {
                    label: t("metaAlliance"),
                    value: selected.allianceId ?? "—",
                  },
                  {
                    label: t("metaAppVersion"),
                    value: selected.appVersion ?? "—",
                  },
                  {
                    label: t("metaBrowser"),
                    value: selected.browserVersion ?? "—",
                  },
                  { label: t("metaOs"), value: selected.osVersion ?? "—" },
                ]}
              />
            </AdminFeedbackDetailPanel>
          ) : (
            <AdminFeedbackDetailPanel>
              <p className="text-sm text-[#8b949e]">{t("selectRow")}</p>
            </AdminFeedbackDetailPanel>
          )
        }
      />
    </div>
  );
}
