"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  isSkyGlacierEventKey,
  SKY_GLACIER_ALLOWED_DOWS,
  type RegularEventKey,
} from "@/lib/regular-events/catalog.shared";
import {
  applyTimeStToSlots,
  defaultTimeStForRule,
  expandRuleMarkersForMonth,
  expandRuleMarkersForWeek,
  monthKeyFromDate,
  slotsAfterTogglingDow,
  trimEmptyMonthGridWeeks,
} from "@/lib/regular-events/calendar-markers.shared";
import type { RegularEventRuleDto } from "@/lib/regular-events/settings.shared";
import {
  toggleOneShotDate,
} from "@/lib/regular-events/schedule-validation.shared";
import {
  effectiveRepeatCadenceForEvent,
  scheduleKindFromCadence,
  type RegularEventRepeatCadence,
} from "@/lib/regular-events/types.shared";
import {
  displayTimeFromServerTime,
  readStoredRegularEventTimeZoneMode,
  serverTimeFromDisplayTime,
  writeStoredRegularEventTimeZoneMode,
  type RegularEventTimeZoneMode,
} from "@/lib/regular-events/time-zone.shared";
import {
  addCalendarDays,
  addCalendarMonths,
  getServerCalendarDate,
  getServerDayOfWeek,
  getWeekStartMonday,
  weekDatesFromMonday,
} from "@/lib/trains/game-time";
import { buildMonthGrid } from "@/lib/trains/trains-display-calendar.shared";

type UpdateRuleInput = {
  ruleId: string;
  scheduleKind: "weekly" | "biweekly" | "once" | "interval_after_last";
  weeklySlots: { dow: number; timeSt: string }[] | null;
  oneShotDates?: string[] | null;
  biweeklyPhaseMonday?: string | null;
  intervalDays?: number | null;
  anchorTimeSt?: string | null;
};

type Props = {
  rules: RegularEventRuleDto[];
  canManage: boolean;
  filterEventKey?: RegularEventKey | string | null;
  busy?: boolean;
  onUpdateRule: (input: UpdateRuleInput) => Promise<void>;
};

const EVENT_CHIP_CLASS: Record<string, string> = {
  marshal_guard:
    "border-amber-500/50 bg-amber-500/20 text-amber-200 light:border-amber-800 light:bg-amber-100 light:text-amber-950",
  zombie_siege:
    "border-emerald-500/50 bg-emerald-500/20 text-emerald-200 light:border-emerald-800 light:bg-emerald-100 light:text-emerald-950",
  glacierdon:
    "border-sky-500/50 bg-sky-500/20 text-sky-200 light:border-sky-800 light:bg-sky-100 light:text-sky-950",
  sky_marshall:
    "border-violet-500/50 bg-violet-500/20 text-violet-200 light:border-violet-800 light:bg-violet-100 light:text-violet-950",
};

const SKY_GLACIER_DOW_SET = new Set<number>(SKY_GLACIER_ALLOWED_DOWS);

export function RegularEventsCalendar({
  rules,
  canManage,
  filterEventKey = null,
  busy = false,
  onUpdateRule,
}: Props) {
  const t = useTranslations("settings.regularEvents");
  const today = getServerCalendarDate();
  const [view, setView] = useState<"week" | "month">("month");
  const [monthKey, setMonthKey] = useState(() => monthKeyFromDate(today));
  const [weekStart, setWeekStart] = useState(() => getWeekStartMonday(today));
  const [timeZoneMode, setTimeZoneMode] = useState<RegularEventTimeZoneMode>(
    () => readStoredRegularEventTimeZoneMode(),
  );
  const visibleRules = useMemo(
    () =>
      filterEventKey
        ? rules.filter((r) => r.eventKey === filterEventKey)
        : rules,
    [filterEventKey, rules],
  );
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(
    () => filterEventKey ?? visibleRules[0]?.eventKey ?? null,
  );
  const activeEventKey = filterEventKey ?? selectedEventKey;
  const activeRule = rules.find((r) => r.eventKey === activeEventKey) ?? null;
  const repeatsLocked = Boolean(
    activeRule && isSkyGlacierEventKey(activeRule.eventKey),
  );
  const [repeatsOverride, setRepeatsOverride] =
    useState<RegularEventRepeatCadence | null>(null);
  const repeats: RegularEventRepeatCadence = repeatsLocked
    ? "biweekly"
    : (repeatsOverride ??
      (activeRule
        ? effectiveRepeatCadenceForEvent(
            activeRule.eventKey,
            activeRule.scheduleKind,
          )
        : "weekly"));

  const markers = useMemo(() => {
    if (view === "week") {
      return expandRuleMarkersForWeek(visibleRules, weekStart);
    }
    return expandRuleMarkersForMonth(visibleRules, monthKey);
  }, [monthKey, view, visibleRules, weekStart]);

  const markersByDate = useMemo(() => {
    const map = new Map<string, typeof markers>();
    for (const m of markers) {
      const list = map.get(m.date) ?? [];
      list.push(m);
      map.set(m.date, list);
    }
    return map;
  }, [markers]);

  const dowNames = [
    t("dow.sun"),
    t("dow.mon"),
    t("dow.tue"),
    t("dow.wed"),
    t("dow.thu"),
    t("dow.fri"),
    t("dow.sat"),
  ];

  const storedTimeSt = activeRule
    ? defaultTimeStForRule(activeRule)
    : "23:00";
  const displayTime = displayTimeFromServerTime(
    storedTimeSt,
    timeZoneMode,
    today,
  );

  const onToggleDate = async (date: string) => {
    if (!canManage || busy || !activeRule) return;
    const dow = getServerDayOfWeek(date);
    if (
      (activeRule.eventKey === "sky_marshall" ||
        activeRule.eventKey === "glacierdon") &&
      !SKY_GLACIER_DOW_SET.has(dow)
    ) {
      return;
    }

    const kind = scheduleKindFromCadence(repeats);
    const timeSt = defaultTimeStForRule(activeRule);

    if (repeats === "once") {
      const nextDates = toggleOneShotDate(activeRule.oneShotDates ?? [], date);
      await onUpdateRule({
        ruleId: activeRule.id,
        scheduleKind: "once",
        weeklySlots: null,
        oneShotDates: nextDates,
        biweeklyPhaseMonday: null,
        intervalDays: null,
        anchorTimeSt: timeSt,
      });
      return;
    }

    const nextSlots = slotsAfterTogglingDow(
      {
        ...activeRule,
        scheduleKind: kind,
        weeklySlots: activeRule.weeklySlots ?? [],
      },
      dow,
    );
    const phase =
      repeats === "biweekly"
        ? (activeRule.biweeklyPhaseMonday ?? getWeekStartMonday(date))
        : null;

    await onUpdateRule({
      ruleId: activeRule.id,
      scheduleKind: kind,
      weeklySlots: nextSlots,
      oneShotDates: null,
      biweeklyPhaseMonday: phase,
      intervalDays: null,
      anchorTimeSt: timeSt,
    });
  };

  const onChangeRepeats = async (next: RegularEventRepeatCadence) => {
    if (repeatsLocked) return;
    setRepeatsOverride(next);
    if (!canManage || busy || !activeRule) return;
    const kind = scheduleKindFromCadence(next);
    const timeSt = defaultTimeStForRule(activeRule);
    if (next === "once") {
      await onUpdateRule({
        ruleId: activeRule.id,
        scheduleKind: "once",
        weeklySlots: null,
        oneShotDates: activeRule.oneShotDates ?? [],
        biweeklyPhaseMonday: null,
        intervalDays: null,
        anchorTimeSt: timeSt,
      });
      return;
    }
    await onUpdateRule({
      ruleId: activeRule.id,
      scheduleKind: kind,
      weeklySlots: activeRule.weeklySlots ?? [],
      oneShotDates: null,
      biweeklyPhaseMonday:
        next === "biweekly"
          ? (activeRule.biweeklyPhaseMonday ?? getWeekStartMonday(today))
          : null,
      intervalDays: null,
      anchorTimeSt: timeSt,
    });
  };

  const onChangeTime = async (displayValue: string) => {
    if (!canManage || busy || !activeRule) return;
    if (!/^\d{1,2}:\d{2}$/.test(displayValue)) return;
    const timeSt = serverTimeFromDisplayTime(displayValue, timeZoneMode, today);
    const kind = scheduleKindFromCadence(repeats);
    if (repeats === "once") {
      await onUpdateRule({
        ruleId: activeRule.id,
        scheduleKind: "once",
        weeklySlots: null,
        oneShotDates: activeRule.oneShotDates ?? [],
        biweeklyPhaseMonday: null,
        intervalDays: null,
        anchorTimeSt: timeSt,
      });
      return;
    }
    const slots = applyTimeStToSlots(activeRule.weeklySlots ?? [], timeSt);
    await onUpdateRule({
      ruleId: activeRule.id,
      scheduleKind: kind,
      weeklySlots: slots,
      oneShotDates: null,
      biweeklyPhaseMonday:
        repeats === "biweekly"
          ? (activeRule.biweeklyPhaseMonday ?? getWeekStartMonday(today))
          : null,
      intervalDays: null,
      anchorTimeSt: timeSt,
    });
  };

  const grid =
    view === "month"
      ? trimEmptyMonthGridWeeks(buildMonthGrid(monthKey, 1))
      : null;
  const weekDates =
    view === "week" ? weekDatesFromMonday(weekStart) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("scheduleTitle")}</h3>
        <div className="flex gap-1 rounded-lg border border-hq-border p-0.5 text-xs">
          <button
            type="button"
            className={`rounded px-2 py-1 ${view === "week" ? "bg-hq-surface-muted" : ""}`}
            onClick={() => setView("week")}
          >
            {t("viewWeek")}
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 ${view === "month" ? "bg-hq-surface-muted" : ""}`}
            onClick={() => setView("month")}
          >
            {t("viewMonth")}
          </button>
        </div>
      </div>

      <p className="text-xs text-hq-fg-muted">{t("scheduleHint")}</p>

      {!filterEventKey ? (
        <div className="flex flex-wrap gap-2">
          {rules.map((rule) => (
            <button
              key={rule.id}
              type="button"
              disabled={!canManage}
              onClick={() => {
                setSelectedEventKey(rule.eventKey);
                setRepeatsOverride(null);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                EVENT_CHIP_CLASS[rule.eventKey] ??
                "border-hq-border bg-hq-surface-muted"
              } ${
                activeEventKey === rule.eventKey ? "ring-2 ring-hq-accent" : ""
              }`}
            >
              {rule.eventLabel}
            </button>
          ))}
        </div>
      ) : null}

      {activeRule && canManage ? (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-hq-fg-muted">{t("repeatsLabel")}</span>
            <select
              className="rounded border border-hq-border bg-hq-bg px-2 py-1"
              value={repeats}
              disabled={busy || repeatsLocked}
              onChange={(e) =>
                void onChangeRepeats(e.target.value as RegularEventRepeatCadence)
              }
            >
              {repeatsLocked ? (
                <option value="biweekly">{t("repeatsBiweekly")}</option>
              ) : (
                <>
                  <option value="once">{t("repeatsOnce")}</option>
                  <option value="weekly">{t("repeatsWeekly")}</option>
                  <option value="biweekly">{t("repeatsBiweekly")}</option>
                </>
              )}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-hq-fg-muted">{t("timeLabel")}</span>
            <input
              type="time"
              className="rounded border border-hq-border bg-hq-bg px-2 py-1"
              value={displayTime}
              disabled={busy}
              onChange={(e) => void onChangeTime(e.target.value)}
            />
          </label>
          <div className="flex gap-1 rounded-lg border border-hq-border p-0.5 text-xs">
            <button
              type="button"
              className={`rounded px-2 py-1 ${timeZoneMode === "server" ? "bg-hq-surface-muted" : ""}`}
              onClick={() => {
                setTimeZoneMode("server");
                writeStoredRegularEventTimeZoneMode("server");
              }}
            >
              {t("timeZoneServer")}
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${timeZoneMode === "local" ? "bg-hq-surface-muted" : ""}`}
              onClick={() => {
                setTimeZoneMode("local");
                writeStoredRegularEventTimeZoneMode("local");
              }}
            >
              {t("timeZoneLocal")}
            </button>
          </div>
          <p className="basis-full text-xs text-hq-fg-muted">
            {t("timeZoneHint")}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded border border-hq-border p-1"
          aria-label={t("prev")}
          onClick={() => {
            if (view === "month") {
              setMonthKey(addCalendarMonths(monthKey, -1));
            } else {
              setWeekStart(addCalendarDays(weekStart, -7));
            }
          }}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium">
          {view === "month" ? monthKey : weekStart}
        </div>
        <button
          type="button"
          className="rounded border border-hq-border p-1"
          aria-label={t("next")}
          onClick={() => {
            if (view === "month") {
              setMonthKey(addCalendarMonths(monthKey, 1));
            } else {
              setWeekStart(addCalendarDays(weekStart, 7));
            }
          }}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {view === "month" && grid ? (
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-hq-fg-muted">
          {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
            <div key={dow}>{dowNames[dow]}</div>
          ))}
          {grid.map((cell) => {
            const dayMarkers = markersByDate.get(cell.date) ?? [];
            const isToday = cell.date === today;
            return (
              <button
                key={cell.date}
                type="button"
                disabled={!canManage || busy || !cell.inMonth}
                onClick={() => void onToggleDate(cell.date)}
                className={`min-h-16 rounded border p-1 text-left ${
                  cell.inMonth
                    ? "border-hq-border bg-hq-bg"
                    : "border-transparent bg-transparent"
                } ${isToday && cell.inMonth ? "ring-2 ring-hq-accent" : ""} ${
                  canManage && cell.inMonth ? "hover:border-hq-accent" : ""
                }`}
              >
                <div
                  className={`text-xs font-medium ${
                    cell.inMonth ? "text-hq-fg" : "text-hq-fg-subtle"
                  }`}
                >
                  {cell.date.slice(8)}
                </div>
                {cell.inMonth ? (
                  <div className="mt-0.5 space-y-0.5">
                    {dayMarkers.slice(0, 3).map((m) => (
                      <div
                        key={`${m.eventKey}-${m.date}`}
                        className={`truncate rounded border px-0.5 ${
                          EVENT_CHIP_CLASS[m.eventKey] ?? "border-hq-border"
                        }`}
                      >
                        {m.eventLabel}
                      </div>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {view === "week" && weekDates ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {weekDates.map((date) => {
            const dayMarkers = markersByDate.get(date) ?? [];
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                disabled={!canManage || busy}
                onClick={() => void onToggleDate(date)}
                className={`min-h-24 rounded border border-hq-border bg-hq-bg p-2 text-left ${
                  isToday ? "ring-2 ring-hq-accent" : ""
                } ${canManage ? "hover:border-hq-accent" : ""}`}
              >
                <div className="text-xs text-hq-fg-muted">
                  {dowNames[getServerDayOfWeek(date)]}
                </div>
                <div className="text-sm font-medium">{date.slice(8)}</div>
                <div className="mt-1 space-y-1">
                  {dayMarkers.map((m) => (
                    <div
                      key={`${m.eventKey}-${m.date}`}
                      className={`rounded border px-1 py-0.5 text-[10px] ${
                        EVENT_CHIP_CLASS[m.eventKey] ?? "border-hq-border"
                      }`}
                    >
                      {m.eventLabel} · {m.timeSt}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
