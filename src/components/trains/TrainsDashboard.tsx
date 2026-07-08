"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ConductorPickModal } from "@/components/trains/ConductorPickModal";
import { ConductorSwapDialog } from "@/components/trains/ConductorSwapDialog";
import { ConductorHistoryTable } from "@/components/trains/ConductorHistoryTable";
import { ConductorWheelModal } from "@/components/trains/ConductorWheelModal";
import { TrainsHelpPanel } from "@/components/trains/TrainsHelpPanel";
import { SpinWeekConductorFlow } from "@/components/trains/SpinWeekConductorFlow";
import { ClearWeekScheduleDialog } from "@/components/trains/ClearWeekScheduleDialog";
import { TrainPivotBanner } from "@/components/trains/TrainPivotBanner";
import { TrainPlanWeekBanner } from "@/components/trains/TrainPlanWeekBanner";
import { PastTemplatePaintConfirmDialog } from "@/components/trains/PastTemplatePaintConfirmDialog";
import { TrainsServerTimeClock } from "@/components/trains/TrainsServerTimeClock";
import { TrainsUserSettingsMenu } from "@/components/trains/TrainsUserSettingsMenu";
import {
  TrainsWalkthroughOverlay,
  trainsWalkthroughSeen,
} from "@/components/trains/TrainsWalkthroughOverlay";
import { TodayConductorCard } from "@/components/trains/TodayConductorCard";
import { WeekTemplateChangeDialog } from "@/components/trains/WeekTemplateChangeDialog";
import { useHotkeys } from "@/components/hotkeys/HotkeyProvider";
import {
  TRAINS_HOTKEY_ACTION_IDS,
  type TrainsHotkeyActionId,
} from "@/lib/hotkeys/trains-hotkeys.shared";
import { WheelBlockedDialog } from "@/components/trains/WheelBlockedDialog";
import {
  TrainPoolDetailsDialog,
  type PoolDetailsOption,
} from "@/components/trains/TrainPoolDetailsDialog";
import { TrainSpinSourcePanel } from "@/components/trains/TrainSpinSourcePanel";
import { TrainMonthCalendar, PAINT_TEMPLATES } from "@/components/trains/TrainMonthCalendar";
import { TemplatePaletteOptionLabel } from "@/components/trains/TemplatePaletteBadge";
import {
  TrainScheduleViewToggle,
  type ScheduleView,
} from "@/components/trains/TrainScheduleViewToggle";
import {
  WeekScheduleStrip,
  canSpinConductor,
  canSpinVip,
} from "@/components/trains/WeekScheduleStrip";
import { Dialog } from "@/components/ui/dialog";
import { AppSelect } from "@/components/ui/AppSelect";
import { Link } from "@/i18n/navigation";
import { buildProvisionalWeekPage } from "@/lib/client/week-schedule-provisional";
import {
  addCalendarDays,
  getMonthKey,
  isWithinPivotWindow,
  monthEndFromKey,
  monthStartFromKey,
} from "@/lib/trains/game-time";
import type {
  MonthSchedulePagePayload,
  TrainsDashboardPayload,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import {
  conductorSpinSource,
  isPoolSpinSource,
  vipSpinSource,
} from "@/lib/trains/spin-source.shared";
import { canStartConductorSwap } from "@/lib/trains/conductor-swap.shared";
import type { PoolRefreshedInfo, PoolType, RollResult, WeekTemplateType } from "@/lib/trains/types";
import type { MemberQualificationPayload } from "@/lib/trains/train-conductor-minimums.shared";
import {
  SELECTABLE_WEEK_TEMPLATES,
  WEEK_TEMPLATES_WITH_DETAIL_HINTS,
} from "@/lib/trains/week-template-registry.shared";
import {
  applyOptimisticConductorPick,
  applyOptimisticConductorRoll,
  applyOptimisticConductorSwap,
  applyOptimisticLock,
  applyOptimisticPaint,
  applyOptimisticUnlock,
  type TrainsDashboardSnapshot,
} from "@/lib/trains/optimistic-dashboard.shared";
import {
  isWheelBlockedError,
  parseTrainRollError,
  type TrainRollErrorDetails,
  type TrainRollErrorResponse,
} from "@/lib/trains/roll-errors.shared";
import { latestLockedDateInWeek, pivotEconomyTargetDates } from "@/lib/trains/week-template-change.shared";
import { spinWeekDayLabel } from "@/lib/trains/spin-week.shared";
import { supportsManualConductorPick, supportsManualVipPick } from "@/lib/trains/templates";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
} from "@/lib/trains/train-week-calendar.shared";
import {
  canManualPickForDate,
  canOfficerChangeTemplateForDate,
  canRollForDate,
} from "@/lib/trains/trains-day-actions.shared";
import {
  TRAINS_DISPLAY_WEEK_STARTS,
} from "@/lib/trains/trains-display-calendar.shared";
import {
  wheelSpeedMultiplier,
} from "@/lib/trains/trains-wheel-speed.shared";
import { isProvisionalDayConfig } from "@/lib/trains/week-schedule-day-configs.shared";

type Props = {
  initial: TrainsDashboardPayload;
};

type RollResponse = TrainRollErrorResponse & {
  result?: RollResult;
  stats?: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  };
  poolsRefreshed?: PoolRefreshedInfo[];
};

type PoolRefreshedHint = PoolRefreshedInfo & {
  role: "conductor" | "vip";
};

const TEMPLATE_OPTIONS = SELECTABLE_WEEK_TEMPLATES;

function inferWeekTemplateFromDayConfigs(
  dayConfigs: Array<{ paintTemplate?: WeekTemplateType | null }>,
): WeekTemplateType {
  if (dayConfigs.length === 0) return "vs_push_week";

  const counts = new Map<WeekTemplateType, number>();
  for (const day of dayConfigs) {
    const key = day.paintTemplate ?? "vs_push_week";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let dominant: WeekTemplateType = "vs_push_week";
  let dominantCount = 0;
  for (const [template, count] of counts) {
    if (count > dominantCount) {
      dominant = template;
      dominantCount = count;
    }
  }
  return dominant;
}

export function TrainsDashboard({ initial }: Props) {
  const t = useTranslations("trains");
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [unlockConfirm, setUnlockConfirm] = useState(false);
  const [trainReadyConfirm, setTrainReadyConfirm] = useState(false);
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
  const [wheelQualification, setWheelQualification] =
    useState<MemberQualificationPayload | null>(null);
  const [wheelDayLabel, setWheelDayLabel] = useState<string | null>(null);
  const [conductorDisqualified, setConductorDisqualified] =
    useState<RollResult | null>(null);
  const [selectedDate, setSelectedDate] = useState(initial.today);
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const [scheduleView, setScheduleView] = useState<ScheduleView>("week");
  const [viewedWeek, setViewedWeek] = useState<WeekSchedulePagePayload>({
    weekStart: initial.weekStart,
    weekEnd: initial.weekEnd,
    templateType: (initial.schedule?.templateType as WeekTemplateType) ?? null,
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
  const [pickRole, setPickRole] = useState<"conductor" | "vip">("conductor");
  const [reseedHintOpen, setReseedHintOpen] = useState(false);
  const [poolRefreshedHint, setPoolRefreshedHint] =
    useState<PoolRefreshedHint | null>(null);
  const poolRefreshedQueueRef = useRef<PoolRefreshedHint[]>([]);
  const [wheelBlocked, setWheelBlocked] = useState<TrainRollErrorDetails | null>(
    null,
  );
  const [pendingTemplateChange, setPendingTemplateChange] = useState<{
    templateType: WeekTemplateType;
    weekStart: string;
    weekEnd: string;
    lockedThroughDate: string | null;
  } | null>(null);
  const [pivotBusy, setPivotBusy] = useState(false);
  const [poolDetailsOpen, setPoolDetailsOpen] = useState(false);
  const [poolDetailsInitialType, setPoolDetailsInitialType] =
    useState<PoolType | null>(null);
  const [walkthroughOpen, setWalkthroughOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    if (!initial.canManageTrains || initial.activeMemberCount === 0) return false;
    return !trainsWalkthroughSeen();
  });
  const [walkthroughKey, setWalkthroughKey] = useState(0);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const [clearWeekOpen, setClearWeekOpen] = useState(false);
  const [clearWeekBusy, setClearWeekBusy] = useState(false);
  const [pendingPastPaint, setPendingPastPaint] = useState<{
    dates: string[];
    templateType: WeekTemplateType;
  } | null>(null);
  const [pastPaintBusy, setPastPaintBusy] = useState(false);
  const [autoRollNotice, setAutoRollNotice] = useState<{
    date: string;
    memberName: string;
    role: "conductor" | "vip";
  } | null>(null);

  const trainWeekConfig = useMemo(
    () => allianceTrainWeekFromRow({ trainWeekStartDow: data.trainWeekStartDow }),
    [data.trainWeekStartDow],
  );

  const { displayWeekStartDow, wheelSpinSpeed } = data;

  const wheelAnimMultiplier = useMemo(
    () => wheelSpeedMultiplier(wheelSpinSpeed),
    [wheelSpinSpeed],
  );

  const weekdayHeaderLabels = useMemo(() => {
    const keys =
      displayWeekStartDow === TRAINS_DISPLAY_WEEK_STARTS.monday
        ? (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)
        : (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const);
    return keys.map((key) => t(`weekdays.${key}`));
  }, [displayWeekStartDow, t]);

  const applySnapshot = useCallback((next: TrainsDashboardSnapshot) => {
    setData(next.data);
    setViewedWeek(next.viewedWeek);
    setViewedMonth(next.viewedMonth);
  }, [setData, setViewedWeek, setViewedMonth]);

  const snapshotRef = useRef<TrainsDashboardSnapshot>({
    data: initial,
    viewedWeek: {
      weekStart: initial.weekStart,
      weekEnd: initial.weekEnd,
      templateType: (initial.schedule?.templateType as WeekTemplateType) ?? null,
      dayConfigs: initial.dayConfigs,
      weekRecords: initial.weekRecords,
    },
    viewedMonth: {
      monthKey: initialMonthKey,
      monthStart: monthStartFromKey(initialMonthKey),
      monthEnd: monthEndFromKey(initialMonthKey),
      dayConfigs: initial.dayConfigs,
      monthRecords: initial.weekRecords,
    },
  });

  useEffect(() => {
    snapshotRef.current = { data, viewedWeek, viewedMonth };
  }, [data, viewedWeek, viewedMonth]);

  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const pendingWheelRollRef = useRef<{
    date: string;
    role: "conductor" | "vip";
    result: NonNullable<RollResponse["result"]>;
  } | null>(null);

  const poolRefreshRole = useCallback(
    (poolType: PoolType): "conductor" | "vip" =>
      poolType === "event_top_x" ? "vip" : "conductor",
    [],
  );

  const presentPoolRefreshedHints = useCallback(
    (items: PoolRefreshedInfo[]) => {
      if (items.length === 0) return;
      const mapped = items.map((item) => ({
        ...item,
        role: poolRefreshRole(item.poolType),
      }));
      setPoolRefreshedHint((current) => {
        if (current) {
          poolRefreshedQueueRef.current.push(...mapped);
          return current;
        }
        const [first, ...rest] = mapped;
        poolRefreshedQueueRef.current.push(...rest);
        return first ?? null;
      });
    },
    [poolRefreshRole, setPoolRefreshedHint],
  );

  const dismissPoolRefreshedHint = useCallback(() => {
    const next = poolRefreshedQueueRef.current.shift() ?? null;
    setPoolRefreshedHint(next);
  }, [setPoolRefreshedHint]);

  const handleWheelClose = useCallback(() => {
    setWheelOpen(false);
    setWheelQualification(null);
    setWheelDayLabel(null);
    const pending = pendingWheelRollRef.current;
    pendingWheelRollRef.current = null;
    if (!pending) return;
    if (pending.result.draftPersisted === false) return;

    applySnapshot(
      applyOptimisticConductorRoll(
        snapshotRef.current,
        pending.date,
        pending.role,
        pending.result,
      ),
    );
    if (pending.result.poolRefreshed) {
      presentPoolRefreshedHints([pending.result.poolRefreshed]);
    }
    void refreshRef.current();
  }, [applySnapshot, presentPoolRefreshedHints]);

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

  const fetchWeek = useCallback(
    async (weekStart: string) => {
      const res = await fetch(
        `/api/trains/schedule/week?weekStart=${encodeURIComponent(weekStart)}`,
      );
      if (!res.ok) {
        setError(t("weekLoadFailed"));
        return;
      }
      const body = (await res.json()) as WeekSchedulePagePayload;
      handleWeekChange(body);
    },
    [handleWeekChange, t],
  );

  const goToToday = useCallback(() => {
    const today = data.today;
    setSelectedDate(today);
    if (scheduleView === "month") {
      void fetchMonth(getMonthKey(today));
      return;
    }
    void fetchWeek(getTrainWeekStart(today, trainWeekConfig));
  }, [data.today, fetchMonth, fetchWeek, scheduleView, trainWeekConfig]);

  const isOnTodayView = useMemo(() => {
    if (selectedDate !== data.today) return false;
    if (scheduleView === "month") {
      return viewedMonth.monthKey === getMonthKey(data.today);
    }
    return viewedWeek.weekStart === getTrainWeekStart(data.today, trainWeekConfig);
  }, [
    data.today,
    scheduleView,
    selectedDate,
    trainWeekConfig,
    viewedMonth.monthKey,
    viewedWeek.weekStart,
  ]);

  const handleScheduleViewChange = useCallback(
    (view: ScheduleView) => {
      setScheduleView(view);
      if (view === "month") {
        void fetchMonth(getMonthKey(selectedDateRef.current));
        return;
      }
      void fetchWeek(
        getTrainWeekStart(selectedDateRef.current, trainWeekConfig),
      );
    },
    [fetchMonth, fetchWeek, trainWeekConfig],
  );

  const targetTrainWeekStart = getTrainWeekStart(selectedDate, trainWeekConfig);
  const targetTrainWeekEnd = addCalendarDays(targetTrainWeekStart, 6);
  const weekViewSeed = useMemo((): WeekSchedulePagePayload => {
    if (viewedWeek.weekStart === targetTrainWeekStart) {
      return viewedWeek;
    }
    const dayConfigs = viewedMonth.dayConfigs.filter(
      (day) => day.date >= targetTrainWeekStart && day.date <= targetTrainWeekEnd,
    );
    const weekRecords = viewedMonth.monthRecords.filter(
      (record) =>
        record.date >= targetTrainWeekStart && record.date <= targetTrainWeekEnd,
    );
    if (dayConfigs.length === 0) {
      return buildProvisionalWeekPage(
        targetTrainWeekStart,
        inferWeekTemplateFromDayConfigs([]),
      );
    }
    return {
      weekStart: targetTrainWeekStart,
      weekEnd: targetTrainWeekEnd,
      templateType: inferWeekTemplateFromDayConfigs(dayConfigs),
      dayConfigs,
      weekRecords,
    };
  }, [
    targetTrainWeekStart,
    targetTrainWeekEnd,
    viewedWeek,
    viewedMonth,
  ]);

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
      vs_push_weekdays: t("templates.vs_push_weekdays"),
      r4_event_vip: t("templates.r4_event_vip"),
      economy_week: t("templates.economy_week"),
      price_is_right: t("templates.price_is_right"),
      r3_recognition: t("templates.r3_recognition"),
      r4_train_week: t("templates.r4_train_week"),
      donations_week: t("templates.donations_week"),
      custom: t("templates.custom"),
    }),
    [t],
  );

  const templateShortLabels = useMemo(
    () => ({
      vs_push_weekdays: t("templatesShort.vs_push_weekdays"),
      r4_event_vip: t("templatesShort.r4_event_vip"),
    }),
    [t],
  );

  const templateSelectOptions = useMemo(
    () =>
      TEMPLATE_OPTIONS.map((template) => ({
        value: template,
        label: (
          <TemplatePaletteOptionLabel
            template={template}
            label={templateLabels[template]}
          />
        ),
      })),
    [templateLabels],
  );

  const activeWeekTemplate = useMemo((): WeekTemplateType => {
    const weekPage =
      viewedWeek.weekStart === targetTrainWeekStart ? viewedWeek : weekViewSeed;
    if (weekPage.templateType) {
      return weekPage.templateType;
    }
    if (
      weekPage.weekStart === data.weekStart &&
      data.schedule?.templateType
    ) {
      return data.schedule.templateType as WeekTemplateType;
    }
    return inferWeekTemplateFromDayConfigs(weekPage.dayConfigs);
  }, [
    data.schedule,
    data.weekStart,
    targetTrainWeekStart,
    viewedWeek,
    weekViewSeed,
  ]);

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
        templateType: (body.schedule?.templateType as WeekTemplateType) ?? null,
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

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const withOptimisticMutation = useCallback(
    async (
      apply: (snap: TrainsDashboardSnapshot) => TrainsDashboardSnapshot,
      request: () => Promise<{ ok: boolean; error?: string }>,
    ): Promise<boolean> => {
      const previous = snapshotRef.current;
      applySnapshot(apply(previous));
      try {
        const result = await request();
        if (!result.ok) {
          applySnapshot(previous);
          if (result.error) setError(result.error);
          return false;
        }
        setError(null);
        void refreshRef.current();
        return true;
      } catch (e) {
        applySnapshot(previous);
        setError(e instanceof Error ? e.message : t("loadFailed"));
        return false;
      }
    },
    [applySnapshot, t],
  );

  const runRoll = async (role: "conductor" | "vip") => {
    setError(null);
    setWheelBlocked(null);
    try {
      const res = await fetch("/api/trains/conductor/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, date: selectedDate }),
      });
      const body = (await res.json()) as RollResponse;
      if (!res.ok || !body.result) {
        const blocked = parseTrainRollError(body);
        if (isWheelBlockedError(blocked)) {
          setWheelBlocked(blocked);
          return;
        }
        setError(body.error ?? t("rollFailed"));
        return;
      }

      const rollDayConfig =
        snapshotRef.current.data.dayConfigs.find(
          (d) => d.date === selectedDate,
        ) ??
        snapshotRef.current.viewedWeek.dayConfigs.find(
          (d) => d.date === selectedDate,
        ) ??
        null;
      const rollConductorMech = effectiveConductorMechanism(
        rollDayConfig?.conductorMechanism,
        rollDayConfig?.paintTemplate,
      );

      if (
        body.result.isAutomatic ||
        (role === "conductor" && rollConductorMech === "r4_sequence")
      ) {
        if (
          role === "conductor" &&
          body.result.qualification &&
          !body.result.qualification.qualified
        ) {
          setConductorDisqualified(body.result);
          return;
        }
        applySnapshot(
          applyOptimisticConductorRoll(
            snapshotRef.current,
            selectedDate,
            role,
            body.result,
          ),
        );
        if (body.result.poolRefreshed) {
          presentPoolRefreshedHints([body.result.poolRefreshed]);
        }
        if (body.result.memberName) {
          setAutoRollNotice({
            date: selectedDate,
            memberName: body.result.memberName,
            role,
          });
        }
        setError(null);
        void refreshRef.current();
        return;
      }

      pendingWheelRollRef.current = {
        date: selectedDate,
        role,
        result: body.result,
      };
      setWheelCandidates(
        body.result.wheelCandidates?.length
          ? body.result.wheelCandidates
          : [
              {
                memberId: body.result.memberId,
                memberName: body.result.memberName,
              },
            ],
      );
      setWheelWinner(body.result);
      setWheelStats(body.stats ?? null);
      setWheelQualification(body.result.qualification ?? null);
      setWheelDayLabel(spinWeekDayLabel(selectedDate));
      setWheelOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rollFailed"));
    }
  };

  const runRollRef = useRef(runRoll);

  useEffect(() => {
    runRollRef.current = runRoll;
  });

  const handleWheelSpinAgain = useCallback(() => {
    pendingWheelRollRef.current = null;
    setWheelOpen(false);
    setWheelQualification(null);
    setWheelWinner(null);
    void runRollRef.current("conductor");
  }, []);

  const handleWheelOverride = useCallback(
    async (overrideReason: string) => {
      const pending = pendingWheelRollRef.current;
      if (!pending?.result.qualification) return;

      setError(null);
      try {
        const res = await fetch("/api/trains/conductor/roll/override", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: pending.date,
            memberId: pending.result.memberId,
            memberName: pending.result.memberName,
            mechanism: pending.result.mechanism,
            overrideReason,
          }),
        });
        const body = (await res.json()) as RollResponse;
        if (!res.ok || !body.result) {
          setError(body.error ?? t("overrideFailed"));
          return;
        }

        applySnapshot(
          applyOptimisticConductorRoll(
            snapshotRef.current,
            pending.date,
            pending.role,
            body.result,
          ),
        );
        pendingWheelRollRef.current = null;
        setWheelOpen(false);
        setWheelQualification(null);
        void refreshRef.current();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("overrideFailed"));
      }
    },
    [applySnapshot, t],
  );

  const lockConductor = async () => {
    await withOptimisticMutation(
      (snap) =>
        applyOptimisticLock(snap, selectedDate, new Date().toISOString()),
      async () => {
        const res = await fetch("/api/trains/conductor/lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: selectedDate }),
        });
        const body = (await res.json()) as RollResponse;
        if (res.ok && body.poolsRefreshed?.length) {
          presentPoolRefreshedHints(body.poolsRefreshed);
        }
        return {
          ok: res.ok,
          error: res.ok ? undefined : (body.error ?? t("lockFailed")),
        };
      },
    );
  };

  const confirmConductorSwap = async (targetDate: string) => {
    if (!selectedRecord?.conductorMemberId) return;
    setSwapBusy(true);
    const lockedAt = new Date().toISOString();
    const ok = await withOptimisticMutation(
      (snap) =>
        applyOptimisticConductorSwap(
          snap,
          selectedDate,
          targetDate,
          lockedAt,
        ),
      async () => {
        const res = await fetch("/api/trains/conductor/swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dateA: selectedDate, dateB: targetDate }),
        });
        const body = (await res.json()) as { error?: string };
        return {
          ok: res.ok,
          error: res.ok ? undefined : (body.error ?? t("swapFailed")),
        };
      },
    );
    setSwapBusy(false);
    if (ok) {
      setSwapOpen(false);
      void refreshRef.current();
    }
  };

  const unlockConductor = async () => {
    setUnlockConfirm(false);
    await withOptimisticMutation(
      (snap) => applyOptimisticUnlock(snap, selectedDate),
      async () => {
        const res = await fetch("/api/trains/conductor/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: selectedDate }),
        });
        const body = (await res.json()) as { error?: string };
        return {
          ok: res.ok,
          error: res.ok ? undefined : (body.error ?? t("unlockFailed")),
        };
      },
    );
  };

  const pickConductor = async (member: {
    memberId: string;
    memberName: string;
  }) => {
    setPickOpen(false);
    await withOptimisticMutation(
      (snap) => applyOptimisticConductorPick(snap, selectedDate, member),
      async () => {
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
        return {
          ok: res.ok,
          error: res.ok ? undefined : (body.error ?? t("pickFailed")),
        };
      },
    );
  };

  const pickVip = async (
    member: {
      memberId: string;
      memberName: string;
    },
    guardianIsVip: boolean,
  ) => {
    setPickOpen(false);
    await withOptimisticMutation(
      (snap) =>
        applyOptimisticConductorRoll(snap, selectedDate, "vip", member, {
          guardianIsVip,
        }),
      async () => {
        const res = await fetch("/api/trains/conductor/vip/pick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: selectedDate,
            memberId: member.memberId,
            memberName: member.memberName,
            guardianIsVip,
          }),
        });
        const body = (await res.json()) as { error?: string };
        return {
          ok: res.ok,
          error: res.ok ? undefined : (body.error ?? t("pickVipFailed")),
        };
      },
    );
  };

  const executePaintDates = useCallback(
    (dates: string[], templateType: WeekTemplateType) => {
      return withOptimisticMutation(
        (snap) => applyOptimisticPaint(snap, dates, templateType),
        async () => {
          const res = await fetch("/api/trains/schedule/days", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dates, templateType }),
          });
          const body = (await res.json()) as { error?: string };
          return {
            ok: res.ok,
            error: res.ok ? undefined : (body.error ?? t("scheduleFailed")),
          };
        },
      );
    },
    [t, withOptimisticMutation],
  );

  const paintDates = useCallback(
    (dates: string[], templateType: WeekTemplateType) => {
      const allowedDates = data.canUnlockConductor
        ? dates
        : dates.filter((date) =>
            canOfficerChangeTemplateForDate(date, data.today),
          );
      if (allowedDates.length === 0) {
        setError(t("scheduleFailed"));
        return Promise.resolve(false);
      }

      if (data.canUnlockConductor) {
        const pastDates = allowedDates.filter(
          (date) => !canOfficerChangeTemplateForDate(date, data.today),
        );
        if (pastDates.length > 0) {
          setPendingPastPaint({ dates: allowedDates, templateType });
          return Promise.resolve(false);
        }
      }

      return executePaintDates(allowedDates, templateType);
    },
    [
      data.canUnlockConductor,
      data.today,
      executePaintDates,
      setError,
      setPendingPastPaint,
      t,
    ],
  );

  const handleTemplateClick = useCallback(
    (templateType: WeekTemplateType) => {
      const weekPage =
        viewedWeek.weekStart === targetTrainWeekStart ? viewedWeek : weekViewSeed;
      const { weekStart, weekEnd, weekRecords } = weekPage;
      const currentTemplate =
        weekPage.templateType ??
        (weekStart === data.weekStart && data.schedule
          ? (data.schedule.templateType as WeekTemplateType)
          : inferWeekTemplateFromDayConfigs(weekPage.dayConfigs));

      if (currentTemplate === templateType) return;

      const lockedThroughDate = latestLockedDateInWeek(
        weekRecords,
        weekStart,
        weekEnd,
      );

      setPendingTemplateChange({
        templateType,
        weekStart,
        weekEnd,
        lockedThroughDate,
      });
    },
    [
      data.schedule,
      data.weekStart,
      setPendingTemplateChange,
      targetTrainWeekStart,
      viewedWeek,
      weekViewSeed,
    ],
  );

  const confirmPendingTemplateChange = useCallback(
    (options: { dates: string[] }) => {
      if (!pendingTemplateChange) return;
      const { templateType } = pendingTemplateChange;
      setPendingTemplateChange(null);
      if (options.dates.length === 0) {
        setError(t("templateChangeConfirm.noDatesBody"));
        return;
      }
      paintDates(options.dates, templateType);
    },
    [paintDates, pendingTemplateChange, setError, setPendingTemplateChange, t],
  );

  const handlePivotToEconomy = useCallback(() => {
    const weekStart = data.weekStart;
    const weekEnd = data.weekEnd;
    const dates = pivotEconomyTargetDates(weekStart, weekEnd, trainWeekConfig).filter(
      (date) => date >= data.today,
    );
    if (dates.length === 0) return;

    setPivotBusy(true);
    void paintDates(dates, "economy_week").finally(() => setPivotBusy(false));
  }, [data.today, data.weekEnd, data.weekStart, paintDates, setPivotBusy, trainWeekConfig]);

  async function confirmClearWeekSchedule() {
    if (!data.canClearWeekSchedule) return;
    setClearWeekBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trains/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: viewedWeek.weekStart }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("clearWeekSchedule.failed"));
        return;
      }
      setClearWeekOpen(false);
      await refreshRef.current();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("clearWeekSchedule.failed"),
      );
    } finally {
      setClearWeekBusy(false);
    }
  }

  const openPoolDetails = useCallback((poolType: PoolType) => {
    setPoolDetailsInitialType(poolType);
    setPoolDetailsOpen(true);
  }, [setPoolDetailsInitialType, setPoolDetailsOpen]);

  const { registerPageHandler } = useHotkeys();

  const trainTemplateHotkeyIds = TRAINS_HOTKEY_ACTION_IDS.filter(
    (id): id is Extract<TrainsHotkeyActionId, `trains.template.${number}`> =>
      id.startsWith("trains.template."),
  );

  useEffect(() => {
    if (data.activeMemberCount === 0) return;

    const cleanups = [
      registerPageHandler("trains.spinWheel", () => {
        void runRollRef.current("conductor");
      }),
      registerPageHandler("trains.spinWeek", () => {
        document
          .querySelector<HTMLButtonElement>('[data-testid="trains-spin-week-btn"]')
          ?.click();
      }),
      registerPageHandler("trains.spinVip", () => {
        void runRollRef.current("vip");
      }),
      registerPageHandler("trains.pickConductor", () => {
        setPickRole("conductor");
        setPickOpen(true);
      }),
      registerPageHandler("trains.pickVip", () => {
        setPickRole("vip");
        setPickOpen(true);
      }),
      registerPageHandler("trains.lockConductor", () => {
        void lockConductor();
      }),
      registerPageHandler("trains.viewPool", () => {
        openPoolDetails("r3");
      }),
      registerPageHandler("trains.scheduleWeek", () => {
        handleScheduleViewChange("week");
      }),
      registerPageHandler("trains.scheduleMonth", () => {
        handleScheduleViewChange("month");
      }),
      registerPageHandler("trains.goToToday", goToToday),
      ...PAINT_TEMPLATES.map((template, index) =>
        registerPageHandler(trainTemplateHotkeyIds[index]!, () => {
          if (!data.canManageTrains) return;
          void paintDates([selectedDate], template);
        }),
      ),
    ];

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [
    data.activeMemberCount,
    data.canManageTrains,
    goToToday,
    handleScheduleViewChange,
    lockConductor,
    openPoolDetails,
    paintDates,
    registerPageHandler,
    selectedDate,
    trainTemplateHotkeyIds,
  ]);

  const reseedPool = async (poolType: PoolType) => {
    setError(null);
    try {
      const res = await fetch("/api/trains/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolType }),
      });
      const body = (await res.json()) as TrainRollErrorResponse;
      if (!res.ok) {
        const blocked = parseTrainRollError(body);
        if (isWheelBlockedError(blocked)) {
          setWheelBlocked(blocked);
          return;
        }
        setError(body.error ?? t("poolFailed"));
        return;
      }
      void refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("poolFailed"));
    }
  };

  const locked = Boolean(selectedRecord?.lockedAt);
  const conductorPaint = selectedDayConfig?.paintTemplate;
  const conductorMech = effectiveConductorMechanism(
    selectedDayConfig?.conductorMechanism,
    conductorPaint,
  );
  const vipMech = selectedDayConfig?.vipMechanism;
  const canPaintTemplate =
    data.canUnlockConductor ||
    canOfficerChangeTemplateForDate(selectedDate, data.today);
  const canRoll = canRollForDate(selectedDate, data.today);
  const canManualPick =
    !locked &&
    supportsManualConductorPick(conductorMech) &&
    canManualPickForDate();
  const canManualPickVip =
    !locked &&
    supportsManualVipPick(vipMech) &&
    canManualPickForDate();
  const showQuickActions =
    data.canManageTrains &&
    (canRoll ||
      canManualPick ||
      canManualPickVip ||
      Boolean(selectedRecord?.conductorMemberId) ||
      locked);
  const selectedConductorSpinSource = conductorSpinSource(
    selectedDayConfig?.conductorMechanism,
    conductorPaint,
  );
  const selectedVipSpinSource = vipSpinSource(vipMech);
  const spinWeekContext = useMemo(() => {
    if (viewedWeek.weekStart === targetTrainWeekStart) {
      return {
        weekStart: viewedWeek.weekStart,
        weekEnd: viewedWeek.weekEnd,
        dayConfigs: viewedWeek.dayConfigs,
        weekRecords: viewedWeek.weekRecords,
      };
    }

    return {
      weekStart: targetTrainWeekStart,
      weekEnd: targetTrainWeekEnd,
      dayConfigs: weekViewSeed.dayConfigs,
      weekRecords: weekViewSeed.weekRecords,
    };
  }, [targetTrainWeekEnd, targetTrainWeekStart, viewedWeek, weekViewSeed]);
  const selectedPoolDetailOptions = useMemo((): PoolDetailsOption[] => {
    const options: PoolDetailsOption[] = [];
    if (isPoolSpinSource(selectedConductorSpinSource)) {
      options.push({
        role: "conductor",
        poolType: selectedConductorSpinSource.poolType,
      });
    }
    if (isPoolSpinSource(selectedVipSpinSource)) {
      options.push({
        role: "vip",
        poolType: selectedVipSpinSource.poolType,
      });
    }
    return options;
  }, [selectedConductorSpinSource, selectedVipSpinSource]);
  const selectedStats =
    selectedDate === data.today &&
    selectedRecord?.conductorMemberId === data.conductorRecord?.conductorMemberId
      ? data.conductorStats
      : null;
  const nextInSequence = data.pools.r4_plus?.nextInSequence ?? null;
  const showPivotBanner =
    data.canManageTrains &&
    data.weekStart === viewedWeek.weekStart &&
    activeWeekTemplate === "vs_push_week" &&
    !data.schedule?.isPivot &&
    isWithinPivotWindow();
  const showPlanWeekBanner =
    data.canManageTrains &&
    data.activeMemberCount > 0 &&
    !data.schedulePersisted &&
    data.weekStart === viewedWeek.weekStart;
  const viewedWeekHasPersistedSchedule = viewedWeek.dayConfigs.some(
    (day) => !isProvisionalDayConfig(day.id),
  );
  const showClearWeekSchedule =
    data.canClearWeekSchedule && viewedWeekHasPersistedSchedule;
  const historyMechanismLabels = useMemo(
    () => ({ ...conductorShortLabels, ...vipShortLabels }),
    [conductorShortLabels, vipShortLabels],
  );

  if (data.activeMemberCount === 0) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        </header>
        <section className="rounded-2xl border border-hq-border bg-hq-surface p-6 text-center">
          <p className="text-sm text-[#c9d1d9]">{t("emptyRosterBody")}</p>
          <Link
            href="/members"
            className="mt-4 inline-flex rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
          >
            {t("emptyRosterCta")}
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
          <TrainsServerTimeClock
            selectedDate={selectedDate}
            today={data.today}
            lockedAt={selectedRecord?.lockedAt ?? null}
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex items-center justify-end gap-2">
            <TrainsHelpPanel
              showTakeTour={data.canManageTrains && data.activeMemberCount > 0}
              onTakeTour={() => {
                setWalkthroughKey((key) => key + 1);
                setWalkthroughOpen(true);
              }}
            />
            <TrainsUserSettingsMenu
              displayWeekStartDow={displayWeekStartDow}
              wheelSpinSpeed={wheelSpinSpeed}
              canEdit
              onPreferencesChange={({ displayWeekStartDow: nextDow, wheelSpinSpeed: nextSpeed }) => {
                setData((current) => ({
                  ...current,
                  displayWeekStartDow: nextDow,
                  wheelSpinSpeed: nextSpeed,
                }));
              }}
              onError={setError}
            />
          </div>
          {data.activeMemberCount > 0 ? (
            <div
              className="flex w-full min-w-0 flex-col gap-1 sm:min-w-[15rem]"
              data-testid="trains-template-selector"
            >
              <span
                id="trains-week-template-label"
                className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted"
              >
                {t("templateSelectLabel")}
              </span>
              <AppSelect
                value={activeWeekTemplate}
                onChange={(value) =>
                  handleTemplateClick(value as WeekTemplateType)
                }
                options={templateSelectOptions}
                disabled={!data.canManageTrains}
                aria-label={t("templateSelectAria")}
                triggerClassName="rounded-xl border-hq-border bg-hq-surface"
                className="w-full"
              />
              {activeWeekTemplate === "price_is_right" ? (
                <p
                  className="text-xs leading-relaxed text-[#8b949e]"
                  data-testid="trains-template-detail-hint"
                >
                  {t("templateDetails.price_is_right")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {data.canManageTrains &&
      data.activeMemberCount > 0 &&
      WEEK_TEMPLATES_WITH_DETAIL_HINTS.includes(activeWeekTemplate) ? (
        <p
          className="text-xs leading-relaxed text-[#8b949e]"
          data-testid="trains-template-detail-hint"
        >
          {t(`templateDetails.${activeWeekTemplate}`)}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">
          {error}
        </p>
      ) : null}

      {autoRollNotice && autoRollNotice.date === selectedDate ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {t("autoRollSuccess", {
            name: autoRollNotice.memberName,
            role:
              autoRollNotice.role === "vip"
                ? t("quickActionsVip")
                : t("quickActionsConductor"),
          })}
          <button
            type="button"
            className="ml-2 text-xs underline opacity-80 hover:opacity-100"
            onClick={() => setAutoRollNotice(null)}
          >
            {t("autoRollDismiss")}
          </button>
        </p>
      ) : null}

      {showPlanWeekBanner ? <TrainPlanWeekBanner /> : null}

      {showPivotBanner ? (
        <TrainPivotBanner onPivot={handlePivotToEconomy} busy={pivotBusy} />
      ) : null}

      {data.activeMemberCount > 0 ? (
        <section
          className="flex flex-col gap-4 rounded-2xl border border-hq-border bg-hq-surface/40 p-4"
          data-testid="trains-schedule-section"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-medium text-hq-fg-muted">
              {t("scheduleSection")}
            </h2>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {showClearWeekSchedule ? (
                <button
                  type="button"
                  onClick={() => setClearWeekOpen(true)}
                  data-testid="trains-clear-week-btn"
                  className="rounded-lg border border-hq-danger-emphasis/50 bg-hq-danger-emphasis/10 px-3 py-1.5 text-xs font-medium text-[#ff7b72] hover:bg-hq-danger-emphasis/20"
                >
                  <span className="mr-1.5 rounded bg-hq-danger-emphasis/25 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ff7b72]">
                    {t("clearWeekSchedule.preprodBadge")}
                  </span>
                  {t("clearWeekSchedule.action")}
                </button>
              ) : null}
              <TrainScheduleViewToggle
                view={scheduleView}
                weekLabel={t("viewWeek")}
                monthLabel={t("viewMonth")}
                onChange={handleScheduleViewChange}
              />
              <button
                type="button"
                onClick={() => goToToday()}
                disabled={isOnTodayView}
                aria-label={t("goToTodayAria")}
                className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-surface disabled:cursor-default disabled:opacity-50"
              >
                {t("goToToday")}
              </button>
            </div>
          </div>

          {scheduleView === "week" ? (
            <WeekScheduleStrip
              today={data.today}
              initialWeekStart={weekViewSeed.weekStart}
              initialWeekEnd={weekViewSeed.weekEnd}
              initialDayConfigs={weekViewSeed.dayConfigs}
              initialWeekRecords={weekViewSeed.weekRecords}
              selectedDate={selectedDate}
              displayWeekStartDow={displayWeekStartDow}
              conductorLabels={conductorShortLabels}
              vipLabels={vipShortLabels}
              templateShortLabels={templateShortLabels}
              navLabels={{
                previousWeek: t("weekNavPrevious"),
                nextWeek: t("weekNavNext"),
                previousDay: t("dayNavPrevious"),
                nextDay: t("dayNavNext"),
              }}
              draftScheduleAriaLabel={t("previewDraftAriaLabel")}
              trainWeekConfig={trainWeekConfig}
              externalWeek={viewedWeek}
              onSelectDate={setSelectedDate}
              onWeekChange={handleWeekChange}
              onWeekLoadError={() => setError(t("weekLoadFailed"))}
            />
          ) : (
            <TrainMonthCalendar
              today={data.today}
              initialMonthKey={getMonthKey(selectedDate)}
              initialDayConfigs={data.dayConfigs}
              initialMonthRecords={data.weekRecords}
              selectedDate={selectedDate}
              displayWeekStartDow={displayWeekStartDow}
              canPaint={data.canManageTrains && canPaintTemplate}
              conductorLabels={conductorShortLabels}
              vipLabels={vipShortLabels}
              templateLabels={templateLabels}
              navLabels={{
                previousMonth: t("monthNavPrevious"),
                nextMonth: t("monthNavNext"),
                paletteTitle: t("paintPaletteTitle"),
                paletteHint: t("paintPaletteHint"),
                weekdayHeaders: weekdayHeaderLabels,
                previewLegend: t("previewLegend"),
                draftScheduleAriaLabel: t("previewDraftAriaLabel"),
              }}
              externalMonth={viewedMonth}
              onSelectDate={setSelectedDate}
              onMonthChange={handleMonthChange}
              onMonthLoadError={() => setError(t("monthLoadFailed"))}
              onPaintDates={paintDates}
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
              guardian: t("guardian"),
              guardianIsVip: t("guardianIsVipHint"),
              guardianIsConductor: t("guardianIsConductorHint"),
              locked: t("locked"),
              unlocked: t("unlocked"),
              lastConducted: t("lastConducted"),
              conductsThisYear: t("conductsThisYear"),
              noneYet: t("noneYet"),
            }}
            substituteBadge={
              selectedRecord?.substituteForMemberName
                ? t("swap.substitutingFor", {
                    name: selectedRecord.substituteForMemberName,
                  })
                : null
            }
            data-testid="trains-conductor-card"
          />

          {/* Quick actions */}
          {showQuickActions ? (
            <div
              className="flex flex-col gap-3 border-t border-hq-border pt-4"
              data-testid="trains-quick-actions"
            >
              <h3 className="text-sm font-medium text-hq-fg-muted">
                {t("quickActions")}
              </h3>
              {(canRoll || canManualPick || canManualPickVip) &&
              (selectedConductorSpinSource != null || selectedVipSpinSource != null) ? (
                <TrainSpinSourcePanel
                  conductorSource={selectedConductorSpinSource}
                  vipSource={selectedVipSpinSource}
                  pools={data.pools}
                  showConductorSpin={selectedConductorSpinSource != null}
                  showVipSpin={selectedVipSpinSource != null}
                  onViewPool={openPoolDetails}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <SpinWeekConductorFlow
                  weekStart={spinWeekContext.weekStart}
                  weekEnd={spinWeekContext.weekEnd}
                  today={data.today}
                  dayConfigs={spinWeekContext.dayConfigs}
                  weekRecords={spinWeekContext.weekRecords}
                  canManageTrains={data.canManageTrains}
                  canSpinViewedWeek={spinWeekContext.weekEnd >= data.today}
                  wheelSpeedMultiplier={wheelAnimMultiplier}
                  snapshotRef={snapshotRef}
                  applySnapshot={applySnapshot}
                  withOptimisticMutation={withOptimisticMutation}
                  presentPoolRefreshedHints={presentPoolRefreshedHints}
                  onError={setError}
                  onRefresh={refresh}
                />
                {canRoll &&
                canSpinConductor(
                  selectedDayConfig?.conductorMechanism,
                  locked,
                  conductorPaint,
                ) ? (
                  <button
                    type="button"
                    onClick={() => void runRoll("conductor")}
                    className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0] w-full sm:w-auto"
                  >
                    {conductorMech === "r4_sequence" && nextInSequence
                      ? t("assignNextInSequence", {
                          name: nextInSequence.memberName,
                        })
                      : t("spinWheel")}
                  </button>
                ) : null}
                {canRoll &&
                (conductorMech === "vs_high_score" ||
                  conductorMech === "donations_top") ? (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => void runRoll("conductor")}
                    className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50 w-full sm:w-auto"
                  >
                    {t("pickTopScorer")}
                  </button>
                ) : null}
                {canManualPick ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPickRole("conductor");
                      setPickOpen(true);
                    }}
                    className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface w-full sm:w-auto"
                  >
                    {t("pickConductorManually")}
                  </button>
                ) : null}
                {canStartConductorSwap(selectedRecord) &&
                spinWeekContext.dayConfigs.some((day) => day.date !== selectedDate) ? (
                  <button
                    type="button"
                    onClick={() => setSwapOpen(true)}
                    className="rounded-lg border border-[#8957e5]/50 bg-[#8957e5]/10 px-4 py-2 text-sm font-medium text-[#d2a8ff] hover:bg-[#8957e5]/20 w-full sm:w-auto"
                  >
                    {t("swap.action")}
                  </button>
                ) : null}
                {canRoll && canSpinVip(vipMech, locked) ? (
                  <button
                    type="button"
                    onClick={() => void runRoll("vip")}
                    className="rounded-lg bg-[#bf8700] px-4 py-2 text-sm font-medium text-white hover:bg-[#d29922] w-full sm:w-auto"
                  >
                    {t("spinVipWheel")}
                  </button>
                ) : null}
                {canManualPickVip ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPickRole("vip");
                      setPickOpen(true);
                    }}
                    className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface w-full sm:w-auto"
                  >
                    {t("pickVipManually")}
                  </button>
                ) : null}
                {!locked && selectedRecord?.conductorMemberId ? (
                  data.trainDiscordConfigured ? (
                    trainReadyConfirm ? (
                      <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-hq-success/40 bg-hq-success/10 px-3 py-2">
                        <span className="text-sm text-hq-green">
                          {t("trainIsReady.confirm", {
                            name: selectedRecord.conductorMemberName ?? "—",
                            date: selectedDate,
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setTrainReadyConfirm(false)}
                          className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-canvas"
                        >
                          {t("trainIsReady.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTrainReadyConfirm(false);
                            void lockConductor();
                          }}
                          className="rounded-md bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover"
                        >
                          {t("trainIsReady.confirmAction")}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setTrainReadyConfirm(true)}
                        className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover w-full sm:w-auto"
                      >
                        {t("trainIsReady.action")}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => void lockConductor()}
                      className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover w-full sm:w-auto"
                    >
                      {t("lockConductor")}
                    </button>
                  )
                ) : null}
                {locked && data.canUnlockConductor ? (
                  unlockConfirm ? (
                    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-hq-danger-emphasis/40 bg-hq-danger-emphasis/10 px-3 py-2">
                      <span className="text-sm text-hq-danger">
                        {t("unlockConfirm")}
                      </span>
                      <button
                        type="button"
                        onClick={() => setUnlockConfirm(false)}
                        className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-canvas"
                      >
                        {t("unlockCancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void unlockConductor()}
                        className="rounded-md bg-hq-danger-emphasis px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-danger"
                      >
                        {t("unlockConfirmAction")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setUnlockConfirm(true)}
                      className="rounded-lg border border-hq-danger-emphasis/60 bg-hq-danger-emphasis/10 px-4 py-2 text-sm font-medium text-hq-danger hover:bg-hq-danger-emphasis/20"
                    >
                      {t("unlockConductor")}
                    </button>
                  )
                ) : null}
              </div>

              {conductorMech === "r3_lottery" || conductorMech === "r4_sequence" ? (
                <div className="flex items-center gap-1.5 self-start">
                  <button
                    type="button"
                    onClick={() =>
                      void reseedPool(
                        conductorMech === "r3_lottery" ? "r3" : "r4_plus",
                      )
                    }
                    className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:text-hq-fg"
                  >
                    {t("reseedPool")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReseedHintOpen(true)}
                    aria-label={t("reseedPoolHint.infoLabel")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-hq-fg-muted hover:bg-hq-canvas hover:text-hq-fg"
                  >
                    <Info className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {data.conductorHistory.length > 0 ? (
        <ConductorHistoryTable
          rows={data.conductorHistory}
          mechanismLabels={historyMechanismLabels}
          labels={{
            title: t("conductorHistory.title"),
            empty: t("conductorHistory.empty"),
            date: t("conductorHistory.date"),
            conductor: t("conductorHistory.conductor"),
            vip: t("conductorHistory.vip"),
            guardian: t("guardian"),
            locked: t("conductorHistory.locked"),
            noneYet: t("noneYet"),
            guardianIsVip: t("guardianIsVipHint"),
            guardianIsConductor: t("guardianIsConductorHint"),
          }}
        />
      ) : null}

      <ConductorPickModal
        open={pickOpen}
        members={data.roster}
        title={
          pickRole === "vip"
            ? t("pickVipTitle", { date: selectedDate.slice(5) })
            : t("pickConductorTitle", { date: selectedDate.slice(5) })
        }
        searchPlaceholder={
          pickRole === "vip"
            ? t("pickVipSearch")
            : t("pickConductorSearch")
        }
        emptyLabel={
          pickRole === "vip" ? t("pickVipEmpty") : t("pickConductorEmpty")
        }
        cancelLabel={
          pickRole === "vip" ? t("pickVipCancel") : t("pickConductorCancel")
        }
        confirmLabel={
          pickRole === "vip" ? t("pickVipConfirm") : t("pickConductorConfirm")
        }
        showGuardianToggle={pickRole === "vip"}
        guardianIsVipLabel={
          pickRole === "vip" ? t("guardianIsVip") : undefined
        }
        onClose={() => setPickOpen(false)}
        onPick={(member, guardianIsVip) =>
          void (pickRole === "vip"
            ? pickVip(member, guardianIsVip)
            : pickConductor(member))
        }
      />

      <ConductorWheelModal
        open={wheelOpen}
        candidates={wheelCandidates}
        winner={wheelWinner}
        stats={wheelStats ?? null}
        qualification={wheelQualification}
        dayLabel={wheelDayLabel}
        speedMultiplier={wheelAnimMultiplier}
        onClose={handleWheelClose}
        onSpinAgain={handleWheelSpinAgain}
        onOverride={(reason) => void handleWheelOverride(reason)}
      />

      <Dialog
        open={conductorDisqualified != null}
        onOpenChange={(open) => {
          if (!open) setConductorDisqualified(null);
        }}
        title={t("wheel.disqualifiedTitle")}
      >
        {conductorDisqualified?.qualification ? (
          <div className="space-y-2 text-sm text-hq-fg">
            <p>
              <span className="font-medium text-hq-danger">
                {conductorDisqualified.memberName}
              </span>{" "}
              {t("wheel.disqualifiedBody")}
            </p>
            {conductorDisqualified.qualification.vs.minimum > 0 ? (
              <p className="text-xs text-hq-fg-muted">
                {t("wheel.vsShortfall", {
                  score: conductorDisqualified.qualification.vs.score,
                  required:
                    conductorDisqualified.qualification.vs.effectiveMinimum,
                  shortfall: conductorDisqualified.qualification.vs.shortfall,
                })}
              </p>
            ) : null}
            {conductorDisqualified.qualification.donation.minimum > 0 ? (
              <p className="text-xs text-hq-fg-muted">
                {t("wheel.donationShortfall", {
                  score: conductorDisqualified.qualification.donation.score,
                  required:
                    conductorDisqualified.qualification.donation
                      .effectiveMinimum,
                  shortfall:
                    conductorDisqualified.qualification.donation.shortfall,
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <WheelBlockedDialog
        open={wheelBlocked != null}
        details={wheelBlocked}
        onClose={() => setWheelBlocked(null)}
        onReseedPool={(poolType) => void reseedPool(poolType)}
      />

      <TrainPoolDetailsDialog
        open={poolDetailsOpen}
        options={selectedPoolDetailOptions}
        initialPoolType={poolDetailsInitialType}
        trainDate={selectedDate}
        onClose={() => {
          setPoolDetailsOpen(false);
          setPoolDetailsInitialType(null);
        }}
      />

      <WeekTemplateChangeDialog
        key={
          pendingTemplateChange
            ? `${pendingTemplateChange.weekStart}:${pendingTemplateChange.templateType}`
            : "closed"
        }
        open={pendingTemplateChange != null}
        templateType={pendingTemplateChange?.templateType ?? null}
        weekStart={pendingTemplateChange?.weekStart ?? null}
        weekEnd={pendingTemplateChange?.weekEnd ?? null}
        today={data.today}
        lockedThroughDate={pendingTemplateChange?.lockedThroughDate ?? null}
        trainWeekConfig={trainWeekConfig}
        onConfirm={confirmPendingTemplateChange}
        onClose={() => setPendingTemplateChange(null)}
      />

      {pendingPastPaint ? (
        <PastTemplatePaintConfirmDialog
          open
          dates={pendingPastPaint.dates.filter(
            (date) => !canOfficerChangeTemplateForDate(date, data.today),
          )}
          templateType={pendingPastPaint.templateType}
          templateLabel={t(`templates.${pendingPastPaint.templateType}`)}
          busy={pastPaintBusy}
          onCancel={() => {
            if (!pastPaintBusy) setPendingPastPaint(null);
          }}
          onConfirm={() => {
            if (pastPaintBusy || !pendingPastPaint) return;
            setPastPaintBusy(true);
            void executePaintDates(
              pendingPastPaint.dates,
              pendingPastPaint.templateType,
            )
              .then((ok) => {
                if (ok) setPendingPastPaint(null);
              })
              .finally(() => setPastPaintBusy(false));
          }}
        />
      ) : null}

      <Dialog
        open={reseedHintOpen}
        onOpenChange={setReseedHintOpen}
        title={t("reseedPoolHint.title")}
      >
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-hq-fg">
              {t("reseedPoolHint.title")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
              {t("reseedPoolHint.body")}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setReseedHintOpen(false)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
            >
              {t("reseedPoolHint.close")}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={poolRefreshedHint != null}
        onOpenChange={(open) => {
          if (!open) dismissPoolRefreshedHint();
        }}
        title={t("poolRefreshedHint.title")}
      >
        {poolRefreshedHint ? (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold text-hq-fg">
                {t("poolRefreshedHint.title")}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#c9d1d9]">
                {poolRefreshedHint.role === "vip"
                  ? t("poolRefreshedHint.vipBody", {
                      poolName: t(
                        `spinSource.poolTypes.${poolRefreshedHint.poolType}`,
                      ),
                    })
                  : t("poolRefreshedHint.conductorBody", {
                      poolName: t(
                        `spinSource.poolTypes.${poolRefreshedHint.poolType}`,
                      ),
                    })}
              </p>
              <p className="mt-2 text-sm text-hq-fg-muted">
                {t("poolRefreshedHint.generationLine", {
                  generation: poolRefreshedHint.generation,
                  count: poolRefreshedHint.memberCount,
                })}
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={dismissPoolRefreshedHint}
                className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
              >
                {t("poolRefreshedHint.close")}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {selectedRecord?.conductorMemberId ? (
        <ConductorSwapDialog
          open={swapOpen}
          sourceDate={selectedDate}
          sourceRecord={selectedRecord}
          dayConfigs={spinWeekContext.dayConfigs}
          weekRecords={spinWeekContext.weekRecords}
          busy={swapBusy}
          onConfirm={(targetDate) => void confirmConductorSwap(targetDate)}
          onClose={() => setSwapOpen(false)}
        />
      ) : null}

      <ClearWeekScheduleDialog
        open={clearWeekOpen}
        weekStart={viewedWeek.weekStart}
        weekEnd={viewedWeek.weekEnd}
        busy={clearWeekBusy}
        onConfirm={() => void confirmClearWeekSchedule()}
        onCancel={() => {
          if (!clearWeekBusy) setClearWeekOpen(false);
        }}
      />

      <TrainsWalkthroughOverlay
        key={walkthroughKey}
        open={walkthroughOpen}
        dashboardReady={data.activeMemberCount > 0}
        onComplete={() => setWalkthroughOpen(false)}
      />
    </div>
  );
}
