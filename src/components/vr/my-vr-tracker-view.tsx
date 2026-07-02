"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";
import type { MyVrPayload, MyVrPostResponse } from "@/lib/vr/my-vr.shared";
import { VR_STEP } from "@/lib/vr/validation";
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
  const [error, setError] = useState<string | null>(null);
  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [setLevelDraft, setSetLevelDraft] = useState("");
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [anomalyMessage, setAnomalyMessage] = useState("");
  const [anomalyProposed, setAnomalyProposed] = useState<number | null>(null);

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
      setData((prev) => ({ ...prev, currentVr: newVr }));
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
        setAnomalyOpen(true);
        setSetDialogOpen(false);
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
    void postVr({ level });
  };

  const confirmAnomaly = (answer: "yes" | "no") => {
    void postVr({ confirm: answer });
  };

  const displayVr = data.currentVr ?? 0;
  const hasReported = data.currentVr != null && data.currentVr > 0;
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
        <h1 className="text-2xl font-semibold tracking-tight text-[#e6edf3]">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-[#8b949e]">{t("pageSubtitle")}</p>
        <p className="text-xs text-[#6e7681]">
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
          className="rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-3 text-sm text-[#8b949e]"
          role="status"
          data-testid="my-vr-post-season-notice"
        >
          {postSeasonNoticeText}
        </p>
      ) : null}

      <div
        className="flex gap-1 rounded-lg border border-[#30363d] bg-[#0d1117] p-1"
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
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {id === "now" ? t("tabNow") : t("tabHistory")}
          </button>
        ))}
      </div>

      {tab === "now" ? (
        <section className="space-y-6" role="tabpanel">
          <div className="rounded-2xl border border-[#30363d] bg-gradient-to-b from-[#161b22] to-[#0d1117] px-6 py-10 text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-[#8b949e]">
              {t("currentVrLabel")}
            </p>
            <p
              className="mt-3 font-mono text-5xl font-bold tabular-nums text-[#e6edf3] sm:text-6xl"
              data-testid="my-vr-hero-value"
            >
              {hasReported ? displayVr : "—"}
            </p>
            {!hasReported ? (
              <p className="mt-2 text-sm text-[#8b949e]">{t("notReportedYet")}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || updatesLocked}
              onClick={bump}
              className="min-w-0 flex-1 rounded-lg border border-[#238636] bg-[#238636] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
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
                  hasReported ? String(displayVr) : String(VR_STEP),
                );
                setSetDialogOpen(true);
              }}
              className="min-w-0 flex-1 rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-3 text-sm font-medium text-[#e6edf3] disabled:opacity-50"
              aria-disabled={updatesLocked}
            >
              {t("updateVr")}
            </button>
          </div>

          {updatesLocked ? (
            <p className="text-sm text-[#8b949e]" role="status">
              {t("seasonLockedError")}
            </p>
          ) : null}

          {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

          <div className="rounded-xl border border-[#30363d] bg-[#161b22]">
            <button
              type="button"
              onClick={() => setPercentileOpen((open) => !open)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[#e6edf3]"
              aria-expanded={percentileOpen}
            >
              {t("percentileTitle")}
              <span className="text-[#8b949e]">{percentileOpen ? "−" : "+"}</span>
            </button>
            {percentileOpen ? (
              <div className="space-y-3 border-t border-[#30363d] px-4 py-4">
                {data.percentile ? (
                  <>
                    <p className="text-sm text-[#c9d1d9]">
                      {t("percentileRank", {
                        rank: data.percentile.rank,
                        count: data.percentile.reporterCount,
                      })}
                    </p>
                    <p className="text-sm text-[#8b949e]">
                      {t("percentileAtOrBelow", {
                        percentile: data.percentile.percentile,
                      })}
                    </p>
                    <div className="h-2 overflow-hidden rounded-full bg-[#21262d]">
                      <div
                        className="h-full rounded-full bg-[#58a6ff] transition-all"
                        style={{ width: `${data.percentile.percentile}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[#8b949e]">{t("percentileNotEnough")}</p>
                )}
              </div>
            ) : null}
          </div>

          {data.events.length >= 2 ? (
            <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <VrHistoryChart events={data.events} />
            </div>
          ) : (
            <p className="text-center text-sm text-[#6e7681]">{t("chartPlaceholder")}</p>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4" role="tabpanel">
          <VrProgressTable events={data.events} />
        </section>
      )}

      <Dialog
        open={setDialogOpen}
        onOpenChange={setSetDialogOpen}
        title={t("setDialogTitle")}
      >
        <form
          className="relative z-[101] w-full max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5 shadow-xl"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            submitSetLevel();
          }}
        >
          <h2 className="text-lg font-semibold text-[#e6edf3]">{t("setDialogTitle")}</h2>
          <p className="text-sm text-[#8b949e]">{t("setDialogDescription")}</p>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-[#e6edf3]">{t("setLabel")}</span>
            <input
              type="number"
              step={VR_STEP}
              min={VR_STEP}
              value={setLevelDraft}
              onChange={(e) => setSetLevelDraft(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm text-[#e6edf3]"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t("setSubmit")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSetDialogOpen(false)}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3]"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={anomalyOpen} onOpenChange={setAnomalyOpen} title={t("anomalyTitle")}>
        <div className="relative z-[101] w-full max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5 shadow-xl">
          <h2 className="text-lg font-semibold text-[#e6edf3]">{t("anomalyTitle")}</h2>
          <p className="text-sm text-[#8b949e]">{anomalyMessage}</p>
          {anomalyProposed != null ? (
            <p className="font-mono text-2xl font-bold text-[#e6edf3]">{anomalyProposed}</p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              disabled={busy}
              onClick={() => confirmAnomaly("yes")}
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t("anomalyConfirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => confirmAnomaly("no")}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3]"
            >
              {t("anomalyDecline")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
