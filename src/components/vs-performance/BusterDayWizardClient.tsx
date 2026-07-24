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
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
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
            {state.phase === "pre_snapshot" ? (
              <p className="text-sm text-hq-fg-muted">{t("reportSoon")}</p>
            ) : null}
          </div>
        ) : null}

        {state.phase === "in_progress" ? (
          <p className="mt-4 text-sm text-hq-fg-muted">{t("reportSoon")}</p>
        ) : null}
      </section>

      {state.phase === "idle" ? (
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

      {state.phase === "post_snapshot" && state.report?.postComplete ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          <p className="text-sm font-medium text-hq-success">
            {t("postComplete")}
          </p>
          <p className="mt-2 text-sm text-hq-fg-muted">{t("reportSoon")}</p>
        </section>
      ) : null}
    </div>
  );
}
