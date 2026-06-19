"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ConductorPickModal } from "@/components/trains/ConductorPickModal";
import { ConductorWheelModal } from "@/components/trains/ConductorWheelModal";
import { TodayConductorCard } from "@/components/trains/TodayConductorCard";
import { TrainMonthCalendar } from "@/components/trains/TrainMonthCalendar";
import {
  TrainScheduleViewToggle,
  type ScheduleView,
} from "@/components/trains/TrainScheduleViewToggle";
import {
  WeekScheduleStrip,
  canSpinConductor,
  canSpinVip,
} from "@/components/trains/WeekScheduleStrip";
import { Link } from "@/i18n/navigation";
import { getMonthKey, monthEndFromKey, monthStartFromKey } from "@/lib/trains/game-time";
import type {
  MonthSchedulePagePayload,
  TrainsDashboardPayload,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import { isCalendarDateOnOrAfter } from "@/lib/trains/game-time";
import { supportsManualConductorPick } from "@/lib/trains/templates";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  initial: TrainsDashboardPayload;
};

type RollResponse = {
  result?: {
    memberId: string;
    memberName: string;
    isAutomatic?: boolean;
    wheelCandidates?: Array<{ memberId: string; memberName: string }>;
  };
  stats?: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  };
  error?: string;
};

const TEMPLATE_OPTIONS: WeekTemplateType[] = [
  "vs_push_week",
  "economy_week",
  "r3_recognition",
  "r4_train_week",
  "donations_week",
];

export function TrainsDashboard({ initial }: Props) {
  const t = useTranslations("trains");
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockConfirm, setUnlockConfirm] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelWinner, setWheelWinner] = useState<{
    memberId: string;
    memberName: string;
  } | null>(null);
  const [wheelStats, setWheelStats] = useState<
    RollResponse["stats"] | null
  >(null);
  const [wheelCandidates, setWheelCandidates] = useState<
    Array<{ memberId: string; memberName: string }>
  >([]);
  const [selectedDate, setSelectedDate] = useState(initial.today);
  const [scheduleView, setScheduleView] = useState<ScheduleView>("week");
  const [viewedWeek, setViewedWeek] = useState<WeekSchedulePagePayload>({
    weekStart: initial.weekStart,
    weekEnd: initial.weekEnd,
    dayConfigs: initial.dayConfigs,
    weekRecords: initial.weekRecords,
  });
  const initialMonthKey = getMonthKey(initial.today);
  const [viewedMonth, setViewedMonth] = useState<MonthSchedulePagePayload>({
    monthKey: initialMonthKey,
    monthStart: monthStartFromKey(initialMonthKey),
    monthEnd: monthEndFromKey(initialMonthKey),
    dayConfigs: initial.dayConfigs,
    monthRecords: initial.weekRecords,
  });
  const viewedWeekStartRef = useRef(initial.weekStart);
  const viewedMonthKeyRef = useRef(initialMonthKey);
  const [pickOpen, setPickOpen] = useState(false);

  const handleWeekChange = useCallback((page: WeekSchedulePagePayload) => {
    viewedWeekStartRef.current = page.weekStart;
    setViewedWeek(page);
  }, []);

  const handleMonthChange = useCallback((page: MonthSchedulePagePayload) => {
    viewedMonthKeyRef.current = page.monthKey;
    setViewedMonth(page);
  }, []);

  const fetchMonth = useCallback(async (monthKey: string) => {
    const res = await fetch(
      `/api/trains/schedule/month?month=${encodeURIComponent(monthKey)}`,
    );
    if (!res.ok) {
      setError(t("monthLoadFailed"));
      return;
    }
    const body = (await res.json()) as MonthSchedulePagePayload;
    handleMonthChange(body);
  }, [handleMonthChange, t]);

  const handleScheduleViewChange = useCallback(
    (view: ScheduleView) => {
      setScheduleView(view);
      if (view === "month") {
        void fetchMonth(viewedMonthKeyRef.current);
      }
    },
    [fetchMonth],
  );

  const activeDayConfigs =
    scheduleView === "month" ? viewedMonth.dayConfigs : viewedWeek.dayConfigs;
  const activeRecords =
    scheduleView === "month"
      ? viewedMonth.monthRecords
      : viewedWeek.weekRecords;

  const selectedDayConfig = useMemo(
    () => activeDayConfigs.find((d) => d.date === selectedDate) ?? null,
    [activeDayConfigs, selectedDate],
  );

  const selectedRecord = useMemo(
    () => activeRecords.find((r) => r.date === selectedDate) ?? null,
    [activeRecords, selectedDate],
  );

  const conductorShortLabels = useMemo(
    () => ({
      vs_high_score: t("mechanismsShort.vsHighScore"),
      vs_top_10: t("mechanismsShort.vsTop10"),
      r3_lottery: t("mechanismsShort.r3Lottery"),
      r4_sequence: t("mechanismsShort.r4Sequence"),
      donations_top: t("mechanismsShort.donationsTop"),
      officer_pick: t("mechanismsShort.officerPick"),
      event_top_x_lottery: t("mechanismsShort.eventTopX"),
      custom: t("mechanismsShort.custom"),
    }),
    [t],
  );

  const vipShortLabels = useMemo(
    () => ({
      conductor_pick: t("vipMechanismsShort.conductorPick"),
      donations_second: t("vipMechanismsShort.donationsSecond"),
      event_top_x_lottery: t("vipMechanismsShort.eventTopX"),
    }),
    [t],
  );

  const templateLabels = useMemo(
    () => ({
      vs_push_week: t("templates.vs_push_week"),
      economy_week: t("templates.economy_week"),
      r3_recognition: t("templates.r3_recognition"),
      r4_train_week: t("templates.r4_train_week"),
      donations_week: t("templates.donations_week"),
      custom: t("templates.custom"),
    }),
    [t],
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/trains/schedule");
    const body = (await res.json()) as TrainsDashboardPayload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? t("loadFailed"));
      return;
    }
    setData(body);
    setError(null);

    const viewedStart = viewedWeekStartRef.current;
    if (viewedStart === body.weekStart) {
      setViewedWeek({
        weekStart: body.weekStart,
        weekEnd: body.weekEnd,
        dayConfigs: body.dayConfigs,
        weekRecords: body.weekRecords,
      });
    } else {
      const weekRes = await fetch(
        `/api/trains/schedule/week?weekStart=${encodeURIComponent(viewedStart)}`,
      );
      if (weekRes.ok) {
        const weekBody = (await weekRes.json()) as WeekSchedulePagePayload;
        setViewedWeek(weekBody);
      }
    }

    const viewedMonthKey = viewedMonthKeyRef.current;
    const monthRes = await fetch(
      `/api/trains/schedule/month?month=${encodeURIComponent(viewedMonthKey)}`,
    );
    if (monthRes.ok) {
      handleMonthChange((await monthRes.json()) as MonthSchedulePagePayload);
    }
  }, [handleMonthChange, t]);

  const runRoll = async (role: "conductor" | "vip") => {
    setBusy(role);
    setError(null);
    try {
      const res = await fetch("/api/trains/conductor/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, date: selectedDate }),
      });
      const body = (await res.json()) as RollResponse;
      if (!res.ok || !body.result) {
        setError(body.error ?? t("rollFailed"));
        return;
      }

      await refresh();

      if (body.result.isAutomatic) {
        return;
      }

      setWheelCandidates(
        body.result.wheelCandidates?.length
          ? body.result.wheelCandidates
          : [{ memberId: body.result.memberId, memberName: body.result.memberName }],
      );
      setWheelWinner(body.result);
      setWheelStats(body.stats ?? null);
      setWheelOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rollFailed"));
    } finally {
      setBusy(null);
    }
  };

  const lockConductor = async () => {
    setBusy("lock");
    setError(null);
    try {
      const res = await fetch("/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("lockFailed"));
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("lockFailed"));
    } finally {
      setBusy(null);
    }
  };

  const unlockConductor = async () => {
    setBusy("unlock");
    setError(null);
    try {
      const res = await fetch("/api/trains/conductor/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("unlockFailed"));
        return;
      }
      setUnlockConfirm(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unlockFailed"));
    } finally {
      setBusy(null);
    }
  };

  const pickConductor = async (member: { memberId: string; memberName: string }) => {
    setBusy("pick");
    setError(null);
    try {
      const res = await fetch("/api/trains/conductor/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          memberId: member.memberId,
          memberName: member.memberName,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("pickFailed"));
        return;
      }
      setPickOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pickFailed"));
    } finally {
      setBusy(null);
    }
  };

  const changeTemplate = async (templateType: WeekTemplateType) => {
    setBusy("schedule");
    setError(null);
    try {
      const res = await fetch("/api/trains/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateType, weekStart: data.weekStart }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("scheduleFailed"));
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("scheduleFailed"));
    } finally {
      setBusy(null);
    }
  };

  const reseedPool = async (poolType: string) => {
    setBusy("pool");
    setError(null);
    try {
      const res = await fetch("/api/trains/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolType }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("poolFailed"));
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("poolFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (data.activeMemberCount === 0) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </header>
        <section className="rounded-2xl border border-[#30363d] bg-[#161b22] p-6 text-center">
          <p className="text-sm text-[#c9d1d9]">{t("emptyRosterBody")}</p>
          <Link
            href="/members"
            className="mt-4 inline-flex rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
          >
            {t("emptyRosterCta")}
          </Link>
        </section>
      </div>
    );
  }

  const locked = Boolean(selectedRecord?.lockedAt);
  const conductorMech = selectedDayConfig?.conductorMechanism;
  const vipMech = selectedDayConfig?.vipMechanism;
  const canManualPick =
    !locked &&
    supportsManualConductorPick(conductorMech) &&
    isCalendarDateOnOrAfter(selectedDate, data.today);
  const dayIsActionable = isCalendarDateOnOrAfter(selectedDate, data.today);
  const selectedStats =
    selectedDate === data.today &&
    selectedRecord?.conductorMemberId === data.conductorRecord?.conductorMemberId
      ? data.conductorStats
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </div>
        {data.schedule ? (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]">
            {t("templateBadge", { template: data.schedule.templateType })}
          </div>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {data.dayConfigs.length > 0 ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-[#30363d] bg-[#161b22]/40 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-medium text-[#8b949e]">
              {t("scheduleSection")}
            </h2>
            <TrainScheduleViewToggle
              view={scheduleView}
              weekLabel={t("viewWeek")}
              monthLabel={t("viewMonth")}
              onChange={handleScheduleViewChange}
            />
          </div>

          {scheduleView === "week" ? (
            <WeekScheduleStrip
              today={data.today}
              initialWeekStart={data.weekStart}
              initialWeekEnd={data.weekEnd}
              initialDayConfigs={data.dayConfigs}
              initialWeekRecords={data.weekRecords}
              selectedDate={selectedDate}
              conductorLabels={conductorShortLabels}
              vipLabels={vipShortLabels}
              navLabels={{
                previousWeek: t("weekNavPrevious"),
                nextWeek: t("weekNavNext"),
              }}
              externalWeek={viewedWeek}
              onSelectDate={setSelectedDate}
              onWeekChange={handleWeekChange}
              onWeekLoadError={() => setError(t("weekLoadFailed"))}
            />
          ) : (
            <TrainMonthCalendar
              today={data.today}
              initialMonthKey={getMonthKey(data.today)}
              initialDayConfigs={data.dayConfigs}
              initialMonthRecords={data.weekRecords}
              selectedDate={selectedDate}
              canPaint={data.canManageTrains}
              conductorLabels={conductorShortLabels}
              vipLabels={vipShortLabels}
              templateLabels={templateLabels}
              navLabels={{
                previousMonth: t("monthNavPrevious"),
                nextMonth: t("monthNavNext"),
                paletteTitle: t("paintPaletteTitle"),
                paletteHint: t("paintPaletteHint"),
                weekdayHeaders: [
                  t("weekdays.mon"),
                  t("weekdays.tue"),
                  t("weekdays.wed"),
                  t("weekdays.thu"),
                  t("weekdays.fri"),
                  t("weekdays.sat"),
                  t("weekdays.sun"),
                ],
              }}
              externalMonth={viewedMonth}
              onSelectDate={setSelectedDate}
              onMonthChange={handleMonthChange}
              onMonthLoadError={() => setError(t("monthLoadFailed"))}
              onPaintError={(message) => setError(message)}
              onPainted={() => void refresh()}
            />
          )}

          <TodayConductorCard
            record={selectedRecord}
            stats={selectedStats}
            dayLabel={
              selectedDate === data.today
                ? t("todayConductor")
                : t("selectedDayConductor", { date: selectedDate.slice(5) })
            }
            labels={{
              awaiting: t("awaitingConductor"),
              vip: t("todayVip"),
              locked: t("locked"),
              unlocked: t("unlocked"),
              lastConducted: t("lastConducted"),
              conductsThisYear: t("conductsThisYear"),
              noneYet: t("noneYet"),
            }}
          />

          {data.canManageTrains && dayIsActionable ? (
            <div className="flex flex-col gap-3 border-t border-[#30363d] pt-4">
              <h3 className="text-sm font-medium text-[#8b949e]">
                {t("quickActions")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {canSpinConductor(conductorMech, locked) ? (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() => void runRoll("conductor")}
                    className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0] disabled:opacity-50"
                  >
                    {busy === "conductor" ? t("spinning") : t("spinWheel")}
                  </button>
                ) : null}
                {conductorMech === "vs_high_score" ||
                conductorMech === "donations_top" ? (
                  <button
                    type="button"
                    disabled={busy != null || locked}
                    onClick={() => void runRoll("conductor")}
                    className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50"
                  >
                    {t("pickTopScorer")}
                  </button>
                ) : null}
                {canManualPick ? (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() => setPickOpen(true)}
                    className="rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#161b22] disabled:opacity-50"
                  >
                    {busy === "pick" ? t("picking") : t("pickConductorManually")}
                  </button>
                ) : null}
                {canSpinVip(vipMech, locked) ? (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() => void runRoll("vip")}
                    className="rounded-lg bg-[#bf8700] px-4 py-2 text-sm font-medium text-white hover:bg-[#d29922] disabled:opacity-50"
                  >
                    {t("spinVipWheel")}
                  </button>
                ) : null}
                {!locked && selectedRecord?.conductorMemberId ? (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() => void lockConductor()}
                    className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50"
                  >
                    {busy === "lock" ? t("locking") : t("lockConductor")}
                  </button>
                ) : null}
                {locked && data.canUnlockConductor ? (
                  unlockConfirm ? (
                    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-[#da3633]/40 bg-[#da3633]/10 px-3 py-2">
                      <span className="text-sm text-[#f85149]">
                        {t("unlockConfirm")}
                      </span>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => setUnlockConfirm(false)}
                        className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-50"
                      >
                        {t("unlockCancel")}
                      </button>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void unlockConductor()}
                        className="rounded-md bg-[#da3633] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#f85149] disabled:opacity-50"
                      >
                        {busy === "unlock"
                          ? t("unlocking")
                          : t("unlockConfirmAction")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() => setUnlockConfirm(true)}
                      className="rounded-lg border border-[#da3633]/60 bg-[#da3633]/10 px-4 py-2 text-sm font-medium text-[#f85149] hover:bg-[#da3633]/20 disabled:opacity-50"
                    >
                      {t("unlockConductor")}
                    </button>
                  )
                ) : null}
              </div>

              {scheduleView === "week" ? (
                <div className="flex flex-wrap gap-2 border-t border-[#30363d] pt-3">
                  <span className="w-full text-xs text-[#8b949e]">
                    {t("changeSchedule")}
                  </span>
                  {TEMPLATE_OPTIONS.map((template) => (
                    <button
                      key={template}
                      type="button"
                      disabled={busy != null}
                      onClick={() => void changeTemplate(template)}
                      className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-50"
                    >
                      {t(`templates.${template}`)}
                    </button>
                  ))}
                </div>
              ) : null}

              {conductorMech === "r3_lottery" || conductorMech === "r4_sequence" ? (
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() =>
                    void reseedPool(
                      conductorMech === "r3_lottery" ? "r3" : "r4_plus",
                    )
                  }
                  className="self-start rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-50"
                >
                  {t("reseedPool")}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : data.canManageTrains ? (
        <section className="rounded-xl border border-dashed border-[#30363d] bg-[#161b22]/50 px-4 py-3 text-sm text-[#8b949e]">
          {t("noScheduleYet")}
        </section>
      ) : null}

      <ConductorPickModal
        open={pickOpen}
        members={data.roster}
        title={t("pickConductorTitle", { date: selectedDate.slice(5) })}
        searchPlaceholder={t("pickConductorSearch")}
        emptyLabel={t("pickConductorEmpty")}
        cancelLabel={t("pickConductorCancel")}
        onClose={() => setPickOpen(false)}
        onPick={(member) => void pickConductor(member)}
      />

      <ConductorWheelModal
        open={wheelOpen}
        candidates={wheelCandidates}
        winner={wheelWinner}
        stats={wheelStats ?? null}
        onClose={() => setWheelOpen(false)}
      />
    </div>
  );
}
