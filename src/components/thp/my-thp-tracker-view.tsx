"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import { fireCelebrationConfetti } from "@/lib/client/celebration-confetti";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import type {
  MyThpPayload,
  MyThpPostResponse,
  ThpBreakdown,
} from "@/lib/thp/my-thp.shared";
import { Dialog } from "@/components/ui/dialog";

import { ThpAnalyticsPanel } from "./thp-analytics-panel";
import { ThpBreakdownForm } from "./thp-breakdown-form";
import { ThpHistoryChart } from "./thp-history-chart";
import { ThpProgressTable } from "./thp-progress-table";

type TabId = "now" | "history";
type ConfirmKind = "anomaly" | "ocr";

type Props = {
  initial: MyThpPayload;
};

export function MyThpTrackerView({ initial }: Props) {
  const t = useTranslations("myThp");
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<TabId>("now");
  const [percentileOpen, setPercentileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [setTotalDraft, setSetTotalDraft] = useState("");

  const [breakdownDialogOpen, setBreakdownDialogOpen] = useState(false);

  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmProposedThp, setConfirmProposedThp] = useState<number | null>(null);
  const [confirmProposedBreakdown, setConfirmProposedBreakdown] =
    useState<ThpBreakdown | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/thp/me");
    const body = (await res.json()) as MyThpPayload & { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? t("loadFailed"));
    }
    setData(body);
  }, [t]);

  const handleResponse = useCallback(
    async (payload: MyThpPostResponse & { error?: string }, resOk: boolean) => {
      if (!resOk) {
        setError(payload.error ?? payload.message ?? t("updateFailed"));
        return;
      }

      if (payload.status === "set_thp") {
        setSetDialogOpen(false);
        setBreakdownDialogOpen(false);
        setConfirmKind(null);
        setSetTotalDraft("");
        fireCelebrationConfetti();
        await refresh();
        return;
      }

      if (
        (payload.status === "anomaly_confirm" || payload.status === "ocr_confirm") &&
        payload.proposedThp != null
      ) {
        setConfirmKind(payload.status === "ocr_confirm" ? "ocr" : "anomaly");
        setConfirmMessage(payload.message);
        setConfirmProposedThp(payload.proposedThp);
        setConfirmProposedBreakdown(payload.proposedBreakdown ?? null);
        setSetDialogOpen(false);
        setBreakdownDialogOpen(false);
        return;
      }

      if (payload.status === "validation_error") {
        setError(payload.message);
        return;
      }

      if (payload.status === "anomaly_rejected") {
        setConfirmKind(null);
        return;
      }

      setError(payload.message);
    },
    [refresh, t],
  );

  const postThp = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/thp/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as MyThpPostResponse & { error?: string };
      await handleResponse(payload, res.ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const uploadScreenshot = async (file: File) => {
    setUploadingScreenshot(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("screenshot", file);
      const res = await fetch("/api/thp/me", {
        method: "POST",
        body: form,
      });
      const payload = (await res.json()) as MyThpPostResponse & { error?: string };
      await handleResponse(payload, res.ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("screenshotUploadFailed"));
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const submitSetTotal = () => {
    const total = Number.parseInt(setTotalDraft, 10);
    if (!Number.isFinite(total) || total <= 0) {
      setError(t("updateFailed"));
      return;
    }
    void postThp({ total });
  };

  const submitBreakdown = (breakdown: ThpBreakdown) => {
    void postThp({ breakdown });
  };

  const confirmProposal = (answer: "yes" | "no") => {
    void postThp({ confirm: answer });
  };

  const onFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void uploadScreenshot(file);
    }
  };

  const currentThp = data.currentThp;
  const hasReported = currentThp != null && currentThp > 0;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-hq-fg">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-hq-fg-muted">{t("pageSubtitle")}</p>
        {data.commanderName ? (
          <p className="text-xs text-hq-fg-subtle">{data.commanderName}</p>
        ) : null}
      </header>

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
              {t("heroThpLabel")}
            </p>
            <p
              className="mt-3 font-mono text-4xl font-bold tabular-nums text-hq-fg sm:text-5xl"
              data-testid="my-thp-hero-value"
            >
              {hasReported ? currentThp.toLocaleString() : "—"}
            </p>
            {!hasReported ? (
              <p className="mt-2 text-sm text-hq-fg-muted">{t("notReportedYet")}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || uploadingScreenshot}
              onClick={() => {
                setSetTotalDraft(hasReported ? String(currentThp) : "");
                setSetDialogOpen(true);
              }}
              className="min-w-0 flex-1 rounded-lg border border-hq-success bg-hq-success px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="my-thp-set-total"
            >
              {t("setTotalButton")}
            </button>
            <button
              type="button"
              disabled={busy || uploadingScreenshot}
              onClick={() => setBreakdownDialogOpen(true)}
              className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-3 text-sm font-medium text-hq-fg disabled:opacity-50"
              data-testid="my-thp-add-breakdown"
            >
              {t("addBreakdownButton")}
            </button>
            <button
              type="button"
              disabled={busy || uploadingScreenshot}
              onClick={() => fileInputRef.current?.click()}
              className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-3 text-sm font-medium text-hq-fg disabled:opacity-50"
              data-testid="my-thp-upload-screenshot"
            >
              {uploadingScreenshot ? t("uploadingScreenshot") : t("uploadScreenshotButton")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFileSelected}
              data-testid="my-thp-screenshot-input"
            />
          </div>

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
                    <p className="text-sm text-hq-fg">
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

          <ThpAnalyticsPanel
            events={data.events}
            breakdown={data.breakdown}
            percentileChange={data.percentileChange}
          />

          {data.events.length >= 2 ? (
            <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
              <ThpHistoryChart events={data.events} />
            </div>
          ) : (
            <p className="text-center text-sm text-hq-fg-subtle">{t("chartPlaceholder")}</p>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-4" role="tabpanel">
          <ThpProgressTable events={data.events} />
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
            submitSetTotal();
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
              value={setTotalDraft}
              onChange={(e) => setSetTotalDraft(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono text-sm text-hq-fg"
              data-testid="my-thp-set-total-input"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              data-testid="my-thp-set-total-submit"
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

      <Dialog
        open={breakdownDialogOpen}
        onOpenChange={setBreakdownDialogOpen}
        title={t("breakdownDialogTitle")}
      >
        <div className="relative z-[101] w-full max-w-lg rounded-xl border border-hq-border bg-hq-surface p-5 shadow-xl">
          <ThpBreakdownForm
            initial={data.breakdown}
            busy={busy}
            onSubmit={submitBreakdown}
            onCancel={() => setBreakdownDialogOpen(false)}
          />
        </div>
      </Dialog>

      <Dialog
        open={confirmKind != null}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title={confirmKind === "ocr" ? t("ocrConfirmTitle") : t("anomalyTitle")}
      >
        <div className="relative z-[101] w-full max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5 shadow-xl">
          <h2 className="text-lg font-semibold text-hq-fg">
            {confirmKind === "ocr" ? t("ocrConfirmTitle") : t("anomalyTitle")}
          </h2>
          <p className="text-sm text-hq-fg-muted">{confirmMessage}</p>
          {confirmProposedThp != null ? (
            <p className="font-mono text-2xl font-bold text-hq-fg" data-testid="my-thp-confirm-proposed">
              {confirmProposedThp.toLocaleString()}
            </p>
          ) : null}
          {confirmProposedBreakdown ? (
            <p className="text-xs text-hq-fg-subtle">{t("breakdownDialogTitle")}</p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              disabled={busy}
              onClick={() => confirmProposal("yes")}
              className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              data-testid="my-thp-confirm-yes"
            >
              {t("anomalyConfirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => confirmProposal("no")}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg"
              data-testid="my-thp-confirm-no"
            >
              {t("anomalyDecline")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
