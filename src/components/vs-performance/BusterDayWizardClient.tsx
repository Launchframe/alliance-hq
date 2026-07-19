"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { ALLIANCE_KILLS_VIDEO_SCORE_TARGET } from "@/lib/video/score-targets";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";
import type {
  BusterDayWizardPhase,
  SerializedBusterDayReport,
} from "@/lib/vs-performance/buster-day.shared";
import type { SerializedBusterDayEfficiencyRow } from "@/lib/vs-performance/buster-day-efficiency.shared";

type EfficiencyPayload = {
  vsWeekMonday: string;
  saturday: string;
  preSnapshotDate: string;
  postSnapshotDate: string;
  vsScoresAvailable: boolean;
  rows: SerializedBusterDayEfficiencyRow[];
};

type WizardState = {
  phase: BusterDayWizardPhase;
  serverDate: string;
  week: {
    vsWeekMonday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
  report: SerializedBusterDayReport | null;
  latestCompleted: SerializedBusterDayReport | null;
  efficiency: EfficiencyPayload | null;
};

function phaseTitleKey(
  phase: BusterDayWizardPhase,
):
  | "phase.pre.title"
  | "phase.inProgress.title"
  | "phase.post.title"
  | "phase.idle.title" {
  switch (phase) {
    case "pre_snapshot":
      return "phase.pre.title";
    case "in_progress":
      return "phase.inProgress.title";
    case "post_snapshot":
      return "phase.post.title";
    case "idle":
      return "phase.idle.title";
  }
}

function phaseBodyKey(
  phase: BusterDayWizardPhase,
):
  | "phase.pre.body"
  | "phase.inProgress.body"
  | "phase.post.body"
  | "phase.idle.body" {
  switch (phase) {
    case "pre_snapshot":
      return "phase.pre.body";
    case "in_progress":
      return "phase.inProgress.body";
    case "post_snapshot":
      return "phase.post.body";
    case "idle":
      return "phase.idle.body";
  }
}

function formatCompactNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPowerM(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function formatEfficiency(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

function EfficiencyReportTable({
  efficiency,
}: {
  efficiency: EfficiencyPayload;
}) {
  const t = useTranslations("busterDay");

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="text-lg font-semibold text-hq-fg">{t("report.title")}</h2>
      <p className="mt-2 text-sm text-hq-fg-muted">{t("report.subtitle")}</p>
      {!efficiency.vsScoresAvailable ? (
        <p className="mt-3 text-sm text-hq-fg-muted">
          {t("report.vsUnavailable")}
        </p>
      ) : null}
      {efficiency.rows.length === 0 ? (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("report.empty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-hq-border text-hq-fg-muted">
              <tr>
                <th className="px-2 py-2 font-medium">{t("report.member")}</th>
                <th className="px-2 py-2 font-medium">{t("report.powerLost")}</th>
                <th className="px-2 py-2 font-medium">
                  {t("report.killsDelta")}
                </th>
                <th className="px-2 py-2 font-medium">
                  {t("report.killPoints")}
                </th>
                <th className="px-2 py-2 font-medium">{t("report.netVs")}</th>
                <th className="px-2 py-2 font-medium">
                  {t("report.efficiency")}
                </th>
              </tr>
            </thead>
            <tbody>
              {efficiency.rows.map((row) => (
                <tr
                  key={row.commanderId}
                  className="border-b border-hq-border/60 text-hq-fg"
                >
                  <td className="px-2 py-2 font-medium">{row.memberName}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {formatPowerM(row.powerLostM)}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {formatCompactNumber(row.killsDelta)}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {formatCompactNumber(row.estimatedKillPointsMin)}–
                    {formatCompactNumber(row.estimatedKillPointsMax)}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {formatCompactNumber(row.netVsScore)}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {row.noEngagement || row.efficiencyRatio == null
                      ? t("report.noEngagement")
                      : formatEfficiency(row.efficiencyRatio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function BusterDayWizardClient() {
  const t = useTranslations("busterDay");
  const tNav = useTranslations("nav");
  const tShell = useTranslations("shellActivity");
  const [state, setState] = useState<WizardState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/vs-performance/buster-day");
      if (cancelled || !res.ok) return;
      setState((await res.json()) as WizardState);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) {
    return <p className="text-sm text-hq-fg-muted">{tShell("loadingPage")}</p>;
  }

  const showUploadActions =
    state.phase === "pre_snapshot" || state.phase === "post_snapshot";
  const snapshotComplete =
    state.phase === "pre_snapshot"
      ? state.report?.preComplete
      : state.phase === "post_snapshot"
        ? state.report?.postComplete
        : false;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <header>
        <Link
          href="/vs-performance"
          className="text-sm text-hq-accent hover:underline"
        >
          {tNav("vsPerformance")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </header>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="text-lg font-semibold text-hq-fg">
          {t(phaseTitleKey(state.phase))}
        </h2>
        <p className="mt-2 text-sm text-hq-fg-muted">
          {t(phaseBodyKey(state.phase))}
        </p>

        {showUploadActions ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Link
                href={buildVideoUploadHref(MEMBER_ROSTER_VIDEO_SCORE_TARGET)}
                className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white hover:bg-hq-success-hover"
              >
                {t("uploadRoster")}
              </Link>
              <Link
                href={buildVideoUploadHref(ALLIANCE_KILLS_VIDEO_SCORE_TARGET)}
                className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white hover:bg-hq-success-hover"
              >
                {t("uploadKills")}
              </Link>
            </div>
            {snapshotComplete ? (
              <p className="text-sm font-medium text-hq-success">
                {state.phase === "pre_snapshot"
                  ? t("preComplete")
                  : t("postComplete")}
              </p>
            ) : (
              <p className="text-sm text-hq-fg-muted">{t("waitingForJobs")}</p>
            )}
            {state.phase === "pre_snapshot" && !state.efficiency ? (
              <p className="text-sm text-hq-fg-muted">{t("reportSoon")}</p>
            ) : null}
          </div>
        ) : null}

        {state.phase === "in_progress" && !state.efficiency ? (
          <p className="mt-4 text-sm text-hq-fg-muted">{t("reportSoon")}</p>
        ) : null}
      </section>

      {state.efficiency ? (
        <EfficiencyReportTable efficiency={state.efficiency} />
      ) : null}

      {state.phase === "idle" && !state.efficiency ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          {state.latestCompleted ? (
            <p className="text-sm text-hq-fg">
              {t("postComplete")} · {state.latestCompleted.vsWeekMonday}
            </p>
          ) : (
            <p className="text-sm text-hq-fg-muted">{t("noReportYet")}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
