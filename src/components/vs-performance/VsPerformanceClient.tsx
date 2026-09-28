"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { AshedEmbedPane } from "@/components/hybrid-ashed/AshedEmbedPane";
import { useRegisterPageHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { VsMatchupResults } from "@/components/vs-performance/VsMatchupResults";
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
  const navLocked = hasDraft || loading;
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
      contextRef.current = initial.contextScope;
      failedTarget.current = null;
      attemptedTarget.current = initial.weekStart;
      setPayload(initial);
      setWeekStart(initial.weekStart);
      setEditing(false);
      setFlags({});
      setTab("native");
      setLoadError(null);
      setLoading(false);
    } else if (!hasDraftRef.current) {
      requestSeq.current += 1;
      failedTarget.current = null;
      attemptedTarget.current = initial.weekStart;
      setPayload(initial);
      setWeekStart(initial.weekStart);
      setLoadError(null);
      setLoading(false);
    }
  }, [initial]);

  const handleSaved = useCallback((next: VsWeekPayload) => {
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
        if (stillActive() && body.contextScope === ctx) {
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
    { "vsPerformance.editPlan": () => startEditing() },
    payload.canEdit && !navLocked,
  );

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
        <div className="h-[min(70vh,720px)]">
          <AshedEmbedPane path="/vsperformance" title={tNav("vsPerformance")} />
        </div>
      ) : (
        <div className={loading ? "space-y-4 opacity-60" : "space-y-4"}>
          <VsMatchupResults
            key={payload.scope}
            payload={payload}
            onSaved={handleSaved}
            setDraftFlag={setDraftFlag}
            navBusy={navLocked}
          />
          <WeeklyVsPlan
            key={payload.scope}
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
        </div>
      )}
    </div>
  );
}
