"use client";

import { Check, Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";

import { addCalendarDays } from "@/lib/trains/game-time";
import {
  catalogDefsForDay,
  formatVsPoints,
  lineScoreForItem,
} from "@/lib/vs-calculator/capacity.shared";
import { pointsForCatalogDay } from "@/lib/vs-calculator/catalog-seed.shared";
import type { VsCalculatorPayload } from "@/lib/vs-calculator/vs-calculator.shared";
import { isCalculatorDay } from "@/lib/vs-calculator/vs-calculator.shared";
import {
  dateForVsMatchDayInWeek,
  mondayOfVsWeekContaining,
} from "@/lib/vs-calculator/vs-calendar.shared";
import { VsCalculatorPlanPanel } from "@/components/vs-calculator/vs-calculator-plan-panel";
import { VsCalculatorUploadPanel } from "@/components/vs-calculator/vs-calculator-upload-panel";

type TabId = "day" | "weekly" | "upload" | "plan";

type Props = {
  initial: VsCalculatorPayload;
};

export function VsCalculatorView({ initial }: Props) {
  const locale = useLocale();
  const t = useTranslations("vsCalculator");
  const tCommon = useTranslations("common");
  const tTrains = useTranslations("vsAnnouncements.vsWeekDays");
  const tSave = useTranslations("vsAnnouncements.saveHints");
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<TabId>("day");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcementCopied, setAnnouncementCopied] = useState(false);
  const [announcementCopyFailed, setAnnouncementCopyFailed] = useState(false);
  const announcementCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const pinnedDay = data.pinnedDay;
  const calculatorDay = isCalculatorDay(pinnedDay) ? pinnedDay : null;
  const plannerEnabled = data.planner?.enabled === true;
  const tabIds = useMemo(() => {
    const ids: TabId[] = ["day", "weekly"];
    if (plannerEnabled) ids.push("plan");
    ids.push("upload");
    return ids;
  }, [plannerEnabled]);
  const dayDefs = useMemo(
    () =>
      calculatorDay != null ? catalogDefsForDay(calculatorDay, data.catalog) : [],
    [calculatorDay, data.catalog],
  );

  const refresh = useCallback(
    async (pinnedDate = data.pinnedDate) => {
      const res = await fetch(
        `/api/tools/vs-calculator/me?date=${encodeURIComponent(pinnedDate)}&locale=${encodeURIComponent(locale)}`,
      );
      const body = (await res.json()) as VsCalculatorPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? t("loadFailed"));
      setData(body);
    },
    [data.pinnedDate, locale, t],
  );

  const copyAnnouncement = useCallback(async () => {
    setAnnouncementCopyFailed(false);
    try {
      await navigator.clipboard.writeText(data.announcementPreview.message);
      setAnnouncementCopied(true);
      if (announcementCopiedTimerRef.current) {
        clearTimeout(announcementCopiedTimerRef.current);
      }
      announcementCopiedTimerRef.current = setTimeout(() => {
        setAnnouncementCopied(false);
      }, 2000);
    } catch {
      setAnnouncementCopyFailed(true);
    }
  }, [data.announcementPreview.message]);

  const shiftPinnedDate = useCallback(
    async (deltaDays: number) => {
      const nextDate = addCalendarDays(data.pinnedDate, deltaDays);
      setError(null);
      try {
        await refresh(nextDate);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    },
    [data.pinnedDate, refresh, t],
  );

  const setQty = useCallback(
    async (slug: string, nextQty: number) => {
      setBusySlug(slug);
      setError(null);
      const quantities = { ...data.quantities, [slug]: Math.max(0, nextQty) };
      if (quantities[slug] === 0) delete quantities[slug];
      try {
        const res = await fetch("/api/tools/vs-calculator/inventory", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantities,
            pinnedDate: data.pinnedDate,
            locale,
          }),
        });
        const body = (await res.json()) as VsCalculatorPayload & {
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? t("saveFailed"));
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("saveFailed"));
      } finally {
        setBusySlug(null);
      }
    },
    [data.pinnedDate, data.quantities, locale, t],
  );

  const clearItem = useCallback(
    async (slug: string) => {
      setBusySlug(slug);
      setError(null);
      try {
        const res = await fetch("/api/tools/vs-calculator/inventory/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, pinnedDate: data.pinnedDate, locale }),
        });
        const body = (await res.json()) as VsCalculatorPayload & {
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? t("saveFailed"));
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("saveFailed"));
      } finally {
        setBusySlug(null);
      }
    },
    [data.pinnedDate, locale, t],
  );

  const themeLabel =
    pinnedDay != null ? tTrains(data.weekly[pinnedDay - 1]?.themeKey ?? "radarTraining") : t("restDay");

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-hq-fg">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-hq-fg-muted">{t("pageSubtitle")}</p>
      </header>

      <section className="space-y-2 rounded-xl border border-hq-border bg-hq-surface p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-hq-fg">
            {t("announcementTitle")}
          </h2>
          <p className="text-xs text-hq-fg-muted">
            {t("announcementHint", {
              date: data.announcementPreview.targetDate,
            })}
          </p>
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void copyAnnouncement()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-xs text-hq-fg sm:w-auto"
            aria-label={tCommon("copyToClipboard")}
          >
            {announcementCopied ? (
              <>
                <Check aria-hidden className="h-3.5 w-3.5 text-hq-green" />
                <span className="text-hq-green">{tCommon("copied")}</span>
              </>
            ) : (
              <>
                <Copy aria-hidden className="h-3.5 w-3.5" />
                <span>{t("announcementCopy")}</span>
              </>
            )}
          </button>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-hq-border bg-hq-canvas p-3">
            <p className="whitespace-pre-wrap break-words font-mono text-xs text-hq-fg">
              {data.announcementPreview.message}
            </p>
          </div>
          {announcementCopyFailed ? (
            <p className="text-xs text-hq-danger" role="alert">
              {tCommon("copyFailed")}
            </p>
          ) : null}
        </div>
      </section>

      <div
        className="flex gap-1 rounded-lg border border-hq-border bg-hq-canvas p-1"
        role="tablist"
      >
        {tabIds.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`vs-calculator-tab-${id}`}
            className={
              tab === id
                ? "flex-1 rounded-md bg-hq-surface-muted px-3 py-2 text-sm font-medium text-hq-fg"
                : "flex-1 rounded-md px-3 py-2 text-sm text-hq-fg-muted hover:text-hq-fg"
            }
            onClick={() => setTab(id)}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      {tab === "day" ? (
        <section className="space-y-4" role="tabpanel">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-sm text-hq-fg"
              onClick={() => void shiftPinnedDate(-1)}
            >
              {t("prevDay")}
            </button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-medium text-hq-fg">
                {data.pinnedDate}
              </p>
              <p className="truncate text-xs text-hq-fg-muted">{themeLabel}</p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-sm text-hq-fg"
              onClick={() => void shiftPinnedDate(1)}
            >
              {t("nextDay")}
            </button>
          </div>

          <div className="rounded-2xl border border-hq-border bg-gradient-to-b from-hq-surface to-hq-canvas p-5 text-center">
            <p className="text-xs uppercase tracking-wide text-hq-fg-subtle">
              {t("dayTotalLabel")}
            </p>
            <p className="font-mono text-4xl font-bold tabular-nums text-hq-fg">
              {formatVsPoints(data.dayTotal)}
            </p>
          </div>

          {calculatorDay == null ? (
            <p className="text-sm text-hq-fg-muted">{t("restDayHint")}</p>
          ) : (
            <ul className="grid gap-3">
              {dayDefs.map((def) => {
                const points = pointsForCatalogDay(def.pointsByDay, calculatorDay!);
                const qty = data.quantities[def.slug] ?? 0;
                const lineTotal = lineScoreForItem(qty, points);
                const disabled = busySlug === def.slug;
                return (
                  <li
                    key={def.slug}
                    className="rounded-xl border border-hq-border bg-hq-surface p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-hq-fg">{def.displayName}</p>
                        <p className="text-xs text-hq-fg-muted">
                          {t("pointsEach", { points: formatVsPoints(points) })}
                        </p>
                      </div>
                      <p className="font-mono text-sm tabular-nums text-hq-accent">
                        {formatVsPoints(lineTotal)}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={disabled}
                        className="h-9 w-9 rounded-lg border border-hq-border bg-hq-canvas text-hq-fg"
                        onClick={() => void setQty(def.slug, qty - 1)}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="h-9 w-full min-w-0 rounded-lg border border-hq-border bg-hq-canvas px-3 text-center font-mono text-sm text-hq-fg"
                        value={qty}
                        disabled={disabled}
                        onChange={(e) => {
                          const next = Number.parseInt(e.target.value, 10);
                          void setQty(
                            def.slug,
                            Number.isFinite(next) ? next : 0,
                          );
                        }}
                      />
                      <button
                        type="button"
                        disabled={disabled}
                        className="h-9 w-9 rounded-lg border border-hq-border bg-hq-canvas text-hq-fg"
                        onClick={() => void setQty(def.slug, qty + 1)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        disabled={disabled || qty === 0}
                        className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-xs text-hq-fg-muted"
                        onClick={() => void clearItem(def.slug)}
                      >
                        {t("clearItem")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "weekly" ? (
        <section className="space-y-3" role="tabpanel">
          <p className="text-sm text-hq-fg-muted">{t("weeklySubtitle")}</p>
          <ul className="space-y-2">
            {data.weekly.map((row) => (
              <li
                key={row.day}
                className="rounded-xl border border-hq-border bg-hq-surface p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-hq-fg">
                      {t("dayLabel", { day: row.day })} — {tTrains(row.themeKey)}
                    </p>
                    <p className="font-mono text-lg tabular-nums text-hq-fg">
                      {formatVsPoints(row.totalPoints)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-xs text-hq-fg"
                    onClick={() => {
                      const weekMonday = mondayOfVsWeekContaining(data.pinnedDate);
                      const date = dateForVsMatchDayInWeek(weekMonday, row.day);
                      void refresh(date).then(() => setTab("day"));
                    }}
                  >
                    {t("openDay")}
                  </button>
                </div>
                {(row.saveHints.radar || row.saveHints.shiny.length > 0) && (
                  <ul className="mt-2 space-y-1 text-xs text-hq-fg-muted">
                    {row.saveHints.radar ? (
                      <li>{tSave(row.saveHints.radar)}</li>
                    ) : null}
                    {row.saveHints.shiny.map((key) => (
                      <li key={key}>{tSave(key)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "plan" && data.planner ? (
        <VsCalculatorPlanPanel
          data={data}
          planner={data.planner}
          onSaved={setData}
        />
      ) : null}

      {tab === "upload" ? (
        <VsCalculatorUploadPanel
          pinnedDate={data.pinnedDate}
          locale={locale}
          onConfirmed={(payload) => {
            setData(payload);
            setTab("day");
          }}
        />
      ) : null}
    </div>
  );
}
