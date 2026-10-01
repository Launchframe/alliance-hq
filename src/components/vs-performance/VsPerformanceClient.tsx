"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { AshedEmbedPane } from "@/components/hybrid-ashed/AshedEmbedPane";
import { useRegisterPageHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { VsMatchupResults } from "@/components/vs-performance/VsMatchupResults";
import { VsScreenshotCapture } from "@/components/vs-performance/VsScreenshotCapture";
import { WeeklyPriceIsFreightPodium } from "@/components/vs-performance/WeeklyPriceIsFreightPodium";
import { WeeklyVsPlan } from "@/components/vs-performance/WeeklyVsPlan";
import { addCalendarDays, getWeekStartMonday } from "@/lib/trains/game-time";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";
import { isVsCalendarDate } from "@/lib/vs-performance/weekly-plan.shared";
import type { VsWeekPayload } from "@/lib/vs-performance/weekly-view.shared";

type Props = {
  initial: VsWeekPayload;
  canUseAshedEmbeds: boolean;
  scoreTargetId: string | null;
};

export function VsPerformanceClient({
  initial,
  canUseAshedEmbeds,
  scoreTargetId,
}: Props) {
  const t = useTranslations("vsPerformance");
  const tEmbed = useTranslations("ashedEmbed");
  const tNav = useTranslations("nav");
  const tHybrid = useTranslations("hybridAshed");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [payload, setPayload] = useState<VsWeekPayload>(initial);
  const [weekStart, setWeekStart] = useState(initial.weekStart);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"native" | "ashed">("native");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [captureOpen, setCaptureOpen] = useState(false);
  const [autoPull, setAutoPull] = useState<{ attemptedScope: string | null; pullingScope: string | null; errorScope: string | null }>({ attemptedScope: null, pullingScope: null, errorScope: null });
  const autoPullSeq = useRef(0);
  const payloadRevision = useRef(0);
  const requestSeq = useRef(0);
  const failedTarget = useRef<string | null>(null);
  const attemptedTarget = useRef<string | null>(null);
  const contextRef = useRef(initial.contextScope);

  const setDraftFlag = useCallback((key: string, dirty: boolean) => {
    setFlags((prev) =>
      prev[key] === dirty ? prev : { ...prev, [key]: dirty },
    );
  }, []);
  const hasDraft = editing || Object.values(flags).some(Boolean);
  const needsAutoPull = tab === "native" && payload.canImportAshed && payload.canEdit && autoPull.attemptedScope !== payload.scope;
  const navLocked = hasDraft || loading || needsAutoPull || autoPull.pullingScope === payload.scope;
  const hasDraftRef = useRef(hasDraft);
  useEffect(() => {
    hasDraftRef.current = hasDraft;
  });

  const prevInitial = useRef(initial);
  useEffect(() => {
    if (prevInitial.current === initial) return;
    prevInitial.current = initial;
    if (initial.contextScope !== contextRef.current) {
      requestSeq.current += 1;
      payloadRevision.current += 1;
      autoPullSeq.current += 1;
      setAutoPull({ attemptedScope: null, pullingScope: null, errorScope: null });
      contextRef.current = initial.contextScope;
      failedTarget.current = null;
      attemptedTarget.current = initial.weekStart;
      setPayload(initial);
      setWeekStart(initial.weekStart);
      setEditing(false);
      setFlags({});
      setTab("native");
      setCaptureOpen(false);
      setLoadError(null);
      setLoading(false);
    } else if (!hasDraftRef.current) {
      requestSeq.current += 1;
      payloadRevision.current += 1;
      failedTarget.current = null;
      attemptedTarget.current = initial.weekStart;
      setPayload(initial);
      setWeekStart(initial.weekStart);
      setLoadError(null);
      setLoading(false);
    }
  }, [initial]);

  const handleSaved = useCallback((next: VsWeekPayload) => {
    if (next.contextScope !== contextRef.current) return;
    payloadRevision.current += 1;
    setPayload((current) =>
      next.scope === current.scope &&
      next.weekStart === current.weekStart &&
      next.contextScope === current.contextScope
        ? next
        : current,
    );
  }, []);

  const loadWeek = useCallback(
    async (target: string) => {
      const seq = ++requestSeq.current;
      const ctx = contextRef.current;
      const stillActive = () =>
        seq === requestSeq.current && ctx === contextRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/vs-performance/week?weekStart=${encodeURIComponent(target)}`,
        );
        if (!res.ok) {
          if (stillActive()) {
            failedTarget.current = target;
            setLoadError("load");
          }
          return;
        }
        const body = (await res.json()) as VsWeekPayload;
        const expectedWeek = getWeekStartMonday(target);
        if (
          stillActive() &&
          body.contextScope === ctx &&
          body.weekStart === expectedWeek
        ) {
          failedTarget.current = null;
          if (body.weekStart !== weekStart) {
            setEditing(false);
            setFlags({});
          }
          setPayload(body);
          setWeekStart(body.weekStart);
        } else if (stillActive()) {
          setLoadError("load");
        }
      } catch {
        if (stillActive()) {
          failedTarget.current = target;
          setLoadError("load");
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [weekStart],
  );

  const goWeek = useCallback(
    (delta: number) => {
      if (navLocked) return;
      const next = getWeekStartMonday(
        addCalendarDays(weekStart, delta * 7),
      );
      const params = new URLSearchParams(searchParams.toString());
      params.set("week", next);
      router.push(`${pathname}?${params.toString()}`);
    },
    [navLocked, weekStart, searchParams, router, pathname],
  );

  const startEditing = useCallback(() => {
    if (payload.canEdit && !editing && !navLocked && tab === "native")
      setEditing(true);
  }, [payload.canEdit, editing, navLocked, tab]);

  useRegisterPageHotkeys(
    {
      "vsPerformance.editPlan": () => startEditing(),
      "vsPerformance.capture": () => {
        if (payload.canEdit && !navLocked && tab === "native")
          setCaptureOpen(true);
      },
    },
    payload.canEdit && !navLocked,
  );

  useEffect(() => {
    if (!needsAutoPull || loading || hasDraftRef.current) return;
    const seq = ++autoPullSeq.current;
    const revision = payloadRevision.current;
    const ctx = payload.contextScope;
    const scope = payload.scope;
    const active = () => seq === autoPullSeq.current && ctx === contextRef.current;
    setAutoPull({ attemptedScope: scope, pullingScope: scope, errorScope: null });
    void (async () => {
      try {
        const res = await fetch("/api/vs-performance/matchup/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart: payload.weekStart, scope, reason: "auto" }),
        });
        const body = (await res.json()) as VsWeekPayload;
        if (!active() || revision !== payloadRevision.current || hasDraftRef.current) return;
        if (!res.ok || body.contextScope !== ctx || body.scope !== scope) {
          setAutoPull(previous => ({ ...previous, errorScope: scope }));
          return;
        }
        handleSaved(body);
      } catch {
        if (active() && revision === payloadRevision.current) setAutoPull(previous => ({ ...previous, errorScope: scope }));
      } finally {
        if (active()) setAutoPull(previous => previous.pullingScope === scope ? { ...previous, pullingScope: null } : previous);
      }
    })();
  }, [needsAutoPull, loading, payload, handleSaved]);

  useEffect(() => {
    if (navLocked) return;
    const param = searchParams.get("week");
    const target =
      param != null && isVsCalendarDate(param)
        ? getWeekStartMonday(param)
        : getWeekStartMonday(payload.today);
    if (target === weekStart) {
      attemptedTarget.current = null;
      return;
    }
    if (attemptedTarget.current === target) return;
    attemptedTarget.current = target;
    queueMicrotask(() => void loadWeek(target));
  }, [searchParams, weekStart, navLocked, payload.today, loadWeek]);

  const weekTitle = t("week.title", {
    date: new Date(`${weekStart}T12:00:00`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    }),
  });
  const isCurrentWeek = weekStart === getWeekStartMonday(payload.today);

  const tabCls = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      active
        ? "bg-hq-accent/15 text-hq-accent"
        : "text-hq-fg-muted hover:bg-hq-surface-muted"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goWeek(-1)}
            disabled={navLocked}
            aria-label={t("week.previous")}
            className="rounded-lg border border-hq-border bg-hq-surface px-2.5 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold text-hq-fg">{weekTitle}</h2>
          <button
            type="button"
            onClick={() => goWeek(1)}
            disabled={navLocked}
            aria-label={t("week.next")}
            className="rounded-lg border border-hq-border bg-hq-surface px-2.5 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
          >
            ›
          </button>
          {!isCurrentWeek ? (
            <button
              type="button"
              onClick={() => {
                if (navLocked) return;
                const current = getWeekStartMonday(payload.today);
                const params = new URLSearchParams(searchParams.toString());
                params.set("week", current);
                router.push(`${pathname}?${params.toString()}`);
              }}
              disabled={navLocked}
              className="rounded-lg border border-hq-border bg-hq-surface px-3 py-1.5 text-xs text-hq-fg-muted hover:bg-hq-surface-muted disabled:opacity-50"
            >
              {t("week.current")}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {payload.canEdit && tab === "native" ? (
            <button
              type="button"
              onClick={() => {
                if (!navLocked) setCaptureOpen(true);
              }}
              disabled={navLocked}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
              data-testid="vs-capture-open"
            >
              {t("capture.open")}
            </button>
          ) : null}
          {scoreTargetId ? (
            <Link
              href={buildVideoUploadHref(scoreTargetId)}
              className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-sm font-medium text-white hover:bg-hq-success-hover"
            >
              {tEmbed("uploadVideoScores")}
            </Link>
          ) : null}
          <Link
            href="/vs-performance/buster-day"
            className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm font-medium text-hq-fg hover:bg-hq-border"
          >
            {tEmbed("busterDayEfficiency")}
          </Link>
        </div>
      </div>

      {canUseAshedEmbeds ? (
        <div
          className="flex gap-1 rounded-xl border border-hq-border bg-hq-surface p-1"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "native"}
            onClick={() => setTab("native")}
            disabled={navLocked}
            className={tabCls(tab === "native")}
          >
            {tHybrid("hqPane")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ashed"}
            onClick={() => setTab("ashed")}
            disabled={navLocked}
            className={tabCls(tab === "ashed")}
          >
            {tHybrid("ashedPane")}
          </button>
        </div>
      ) : null}

      {loadError ? (
        <div className="flex items-center gap-3 rounded-xl border border-hq-border bg-hq-surface p-5" role="alert">
          <p className="text-sm text-hq-danger">{t("errors.load")}</p>
          <button
            type="button"
            onClick={() =>
              failedTarget.current != null &&
              void loadWeek(failedTarget.current)
            }
            className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border"
          >
            {t("actions.retry")}
          </button>
        </div>
      ) : null}

      {tab === "ashed" ? (
        <div className="overflow-hidden rounded-xl border border-hq-border">
          <AshedEmbedPane path="/vsperformance" title={tNav("vsPerformance")} />
        </div>
      ) : (
        <div className={loading ? "space-y-4 opacity-60" : "space-y-4"}>
          {autoPull.errorScope === payload.scope ? <p role="alert" className="text-sm text-hq-danger">{t("matchup.importFailed")}</p> : null}
          {autoPull.pullingScope === payload.scope ? <p role="status" className="text-sm text-hq-fg-muted">{t("actions.loading")}</p> : null}
          <VsMatchupResults
            key={`${payload.scope}:results`}
            payload={payload}
            onSaved={handleSaved}
            setDraftFlag={setDraftFlag}
            navBusy={navLocked}
          />
          <WeeklyVsPlan
            key={`${payload.scope}:plan`}
            payload={payload}
            editing={editing}
            onEditingChange={setEditing}
            onSaved={handleSaved}
            reportDirty={(dirty) => setDraftFlag("plan", dirty)}
            navBusy={navLocked}
          />
          {payload.pif || payload.pifError ? (
            <WeeklyPriceIsFreightPodium
              board={payload.pif}
              error={payload.pifError}
            />
          ) : null}
          <VsScreenshotCapture
            key={payload.contextScope}
            payload={payload}
            onSaved={handleSaved}
            setDraftFlag={setDraftFlag}
            open={captureOpen}
            onOpenChange={setCaptureOpen}
          />
        </div>
      )}
    </div>
  );
}
