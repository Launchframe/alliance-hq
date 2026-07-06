"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";
import type { MyVrPayload, MyVrPostResponse } from "@/lib/vr/my-vr.shared";
import { effectiveBaseVr } from "@/lib/vr/effective-vr.shared";
import {
  coerceInstituteLevelFromBaseVr,
  maxInstituteLevel,
} from "@/lib/vr/validation";
import { Dialog } from "@/components/ui/dialog";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

import { VrHistoryChart } from "./vr-history-chart";
import { VrProgressTable } from "./vr-progress-table";

type TabId = "now" | "history";

type Props = {
  initial: MyVrPayload;
};

export function MyVrTrackerView({ initial }: Props) {
  const t = useTranslations("myVr");
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<TabId>("now");
  const [percentileOpen, setPercentileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [setLevelDraft, setSetLevelDraft] = useState("");
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [anomalyMessage, setAnomalyMessage] = useState("");
  const [anomalyProposed, setAnomalyProposed] = useState<number | null>(null);
  const [anomalyProposedLevel, setAnomalyProposedLevel] = useState<number | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/vr/me");
    const body = (await res.json()) as MyVrPayload & { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? t("loadFailed"));
    }
    setData(body);
  }, [t]);

  const onVrUpdated = useCallback(
    async (newVr: number) => {
      fireCelebrationConfetti();
      await refresh();
      setData((prev) => {
        const pass = prev.weeklyPassActive ?? false;
        return {
          ...prev,
          currentVr: newVr,
          instituteLevel: coerceInstituteLevelFromBaseVr(prev.seasonKey, newVr),
          effectiveVr: effectiveBaseVr(newVr, pass),
        };
      });
    },
    [refresh],
  );

  const postVr = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vr/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as MyVrPostResponse & { error?: string };
      if (!res.ok) {
        setError(payload.error ?? payload.message ?? t("updateFailed"));
        return;
      }

      if (payload.status === "set_vr" && payload.newVr != null) {
        setSetDialogOpen(false);
        setAnomalyOpen(false);
        setSetLevelDraft("");
        await onVrUpdated(payload.newVr);
        return;
      }

      if (payload.status === "anomaly_confirm" && payload.proposedVr != null) {
        setAnomalyMessage(payload.message);
        setAnomalyProposed(payload.proposedVr);
        setAnomalyProposedLevel(payload.proposedInstituteLevel ?? null);
        setAnomalyOpen(true);
        setSetDialogOpen(false);
        return;
      }

      if (payload.status === "validation_error") {
        setError(payload.message);
        return;
      }

      if (payload.status === "season_locked") {
        setSetDialogOpen(false);
        setAnomalyOpen(false);
        setError(payload.message ?? t("seasonLockedError"));
        await refresh();
        return;
      }

      if (payload.status === "anomaly_rejected") {
        setAnomalyOpen(false);
        return;
      }

      setError(payload.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const bump = () => void postVr({});

  const submitSetLevel = () => {
    const level = Number.parseInt(setLevelDraft, 10);
    if (!Number.isFinite(level)) {
      setError(t("updateFailed"));
      return;
    }
    void postVr({ instituteLevel: level });
  };

  const toggleWeeklyPass = async (active: boolean) => {
    setPassBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vr/weekly-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? t("weeklyPassUpdateFailed"));
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("weeklyPassUpdateFailed"));
    } finally {
      setPassBusy(false);
    }
  };

  const confirmAnomaly = (answer: "yes" | "no") => {
    void postVr({ confirm: answer });
  };

  const baseVr = data.currentVr;
  const heroVr = data.effectiveVr;
  const hasReported = baseVr != null && baseVr > 0;
  const maxLevel = maxInstituteLevel(data.seasonKey);
  const updatesLocked = data.vrUpdatesLocked;
  const seasonLabelText = data.vrSandboxActive
    ? t("sandboxSeasonLabel")
    : updatesLocked && data.priorSeason
      ? t("seasonLabel", { season: data.priorSeason })
      : t("seasonLabel", { season: data.seasonKey });

  const postSeasonNoticeText =
    data.priorSeason != null && data.seasonMaxVr != null
      ? t("postSeasonNotice", {
          maxVr: data.seasonMaxVr,
          priorSeason: data.priorSeason,
        })
      : data.priorSeason != null
        ? t("postSeasonNoticeUnreported", { priorSeason: data.priorSeason })
        : null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-hq-fg">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-hq-fg-muted">{t("pageSubtitle")}</p>
        <p className="text-xs text-hq-fg-subtle">
          {seasonLabelText}
          {data.commanderName ? ` · ${data.commanderName}` : ""}
        </p>
      </header>

      {data.vrSandboxActive ? (
        <p
          className="rounded-lg border border-[#d29922]/50 bg-[#d2992210] px-4 py-3 text-sm text-[#d29922]"
          role="status"
          data-testid="my-vr-sandbox-notice"
        >
          {t("sandboxActiveNotice")}
        </p>
      ) : null}

      {updatesLocked && postSeasonNoticeText ? (
        <p
          className="rounded-lg border border-hq-border bg-hq-surface px-4 py-3 text-sm text-hq-fg-muted"
          role="status"
          data-testid="my-vr-post-season-notice"
        >
          {postSeasonNoticeText}
        </p>
      ) : null}

      <div
        className="flex gap-1 rounded-lg border border-hq-border bg-hq-canvas p-1"
        role="tablist"
        aria-label={t("sectionsAriaLabel")}
      >
        {(["now", "history"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-w-0 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? "bg-hq-surface-muted text-hq-fg"
                : "text-hq-fg-muted hover:text-hq-fg"
            }`}
          >
            {id === "now" ? t("tabNow") : t("tabHistory")}
          </button>
        ))}
      </div>

      {tab === "now" ? (
        <section className="space-y-6" role="tabpanel">
          <div className="rounded-2xl border border-hq-border bg-gradient-to-b from-hq-surface to-hq-canvas px-6 py-10 text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-hq-fg-muted">
              {t("effectiveVrLabel")}
            </p>
            <p
              className="mt-3 font-mono text-5xl font-bold tabular-nums text-hq-fg sm:text-6xl"
              data-testid="my-vr-hero-value"
            >
              {hasReported && heroVr != null ? heroVr : "—"}
            </p>
            {hasReported && baseVr != null ? (
              <p
                className="mt-2 font-mono text-sm text-hq-fg-muted"
                data-testid="my-vr-breakdown"
              >
                {data.weeklyPassActive
                  ? t("vrBreakdownWithPass", {
                      base: baseVr,
                      pass: data.weeklyPassBoost,
                    })
                  : t("vrBreakdownBaseOnly", { base: baseVr })}
              </p>
            ) : null}
            {hasReported && data.instituteLevel != null ? (
              <p className="mt-1 text-sm text-hq-fg-subtle" data-testid="my-vr-institute-level">
                {t("levelLine", { level: data.instituteLevel })}
              </p>
            ) : null}
            {!hasReported ? (
              <p className="mt-2 text-sm text-hq-fg-muted">{t("notReportedYet")}</p>
            ) : null}
          </div>

          {hasReported ? (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-hq-border bg-hq-surface px-4 py-3">
              <span className="min-w-0 text-sm text-[#c9d1d9]">
                {t("weeklyPassLabel")}
              </span>
              <input
                type="checkbox"
                checked={data.weeklyPassActive ?? false}
                disabled={busy || passBusy || updatesLocked}
                onChange={(e) => void toggleWeeklyPass(e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-hq-border bg-hq-canvas accent-hq-success"
                data-testid="my-vr-weekly-pass-toggle"
                aria-label={t("weeklyPassLabel")}
              />
            </label>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || updatesLocked}
              onClick={bump}
              className="min-w-0 flex-1 rounded-lg border border-hq-success bg-hq-success px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="my-vr-bump"
              aria-disabled={updatesLocked}
            >
              {t("bumpButton")}
            </button>
            <button
              type="button"
              disabled={busy || updatesLocked}
              onClick={() => {
                setSetLevelDraft(
                  hasReported && data.instituteLevel != null
                    ? String(data.instituteLevel)
                    : "1",
                );
                setSetDialogOpen(true);
              }}
              className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-3 text-sm font-medium text-hq-fg disabled:opacity-50"
              aria-disabled={updatesLocked}
            >
              {t("updateVr")}
            </button>
          </div>

          {updatesLocked ? (
            <p className="text-sm text-hq-fg-muted" role="status">
              {t("seasonLockedError")}
            </p>
          ) : null}

          {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

          <div className="rounded-xl border border-hq-border bg-hq-surface">
            <button
              type="button"
              onClick={() => setPercentileOpen((open) => !open)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-hq-fg"
              aria-expanded={percentileOpen}
            >
              {t("percentileTitle")}
              <span className="text-hq-fg-muted">{percentileOpen ? "−" : "+"}</span>
            </button>
            {percentileOpen ? (
              <div className="space-y-3 border-t border-hq-border px-4 py-4">
                {data.percentile ? (
                  <>
                    <p className="text-sm text-[#c9d1d9]">
                      {t("percentileRank", {
                        rank: data.percentile.rank,
                        count: data.percentile.reporterCount,
                      })}
                    </p>
                    <p className="text-sm text-hq-fg-muted">
                      {t("percentileAtOrBelow", {
                        percentile: data.percentile.percentile,
                      })}
                    </p>
                    <div className="h-2 overflow-hidden rounded-full bg-hq-surface-muted">
                      <div
                        className="h-full rounded-full bg-hq-accent transition-all"
                        style={{ width: `${data.percentile.percentile}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-hq-fg-muted">{t("percentileNotEnough")}</p>
                )}
              </div>
            ) : null}
          </div>

          {data.events.length >= 2 ? (
            <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
              <VrHistoryChart events={data.events} />
            </div>
          ) : (
            <p className="text-center text-sm text-hq-fg-subtle">{t("chartPlaceholder")}</p>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-4" role="tabpanel">
          <VrProgressTable seasonKey={data.seasonKey} events={data.events} />
        </section>
      )}

      <Dialog
        open={setDialogOpen}
        onOpenChange={setSetDialogOpen}
        title={t("setDialogTitle")}
      >
        <form
          className="relative z-[101] w-full max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5 shadow-xl"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            submitSetLevel();
          }}
        >
          <h2 className="text-lg font-semibold text-hq-fg">{t("setDialogTitle")}</h2>
          <p className="text-sm text-hq-fg-muted">{t("setDialogDescription")}</p>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-hq-fg">{t("setLabel")}</span>
            <input
              type="number"
              step={1}
              min={1}
              max={maxLevel}
              value={setLevelDraft}
              onChange={(e) => setSetLevelDraft(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t("setSubmit")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSetDialogOpen(false)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={anomalyOpen} onOpenChange={setAnomalyOpen} title={t("anomalyTitle")}>
        <div className="relative z-[101] w-full max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5 shadow-xl">
          <h2 className="text-lg font-semibold text-hq-fg">{t("anomalyTitle")}</h2>
          <p className="text-sm text-hq-fg-muted">{anomalyMessage}</p>
          {anomalyProposedLevel != null ? (
            <p className="font-mono text-lg text-hq-fg-muted">
              {t("levelLine", { level: anomalyProposedLevel })}
            </p>
          ) : null}
          {anomalyProposed != null ? (
            <p className="font-mono text-2xl font-bold text-hq-fg">
              {data.weeklyPassActive
                ? t("vrBreakdownWithPass", {
                    base: anomalyProposed,
                    pass: data.weeklyPassBoost,
                  })
                : t("vrBreakdownBaseOnly", { base: anomalyProposed })}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              disabled={busy}
              onClick={() => confirmAnomaly("yes")}
              className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t("anomalyConfirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => confirmAnomaly("no")}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg"
            >
              {t("anomalyDecline")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
