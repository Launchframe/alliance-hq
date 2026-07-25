"use client";

import { ChevronDown, Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { ConductorPickModal } from "@/components/trains/ConductorPickModal";
import { ConductorSwapDialog } from "@/components/trains/ConductorSwapDialog";
import { ConductorHistoryTable } from "@/components/trains/ConductorHistoryTable";
import { ConductorWheelModal } from "@/components/trains/ConductorWheelModal";
import { TrainsHelpPanel } from "@/components/trains/TrainsHelpPanel";
import { TrainsGuidedConductorFlow } from "@/components/trains/TrainsGuidedConductorFlow";
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
import { PriceIsRightPodiumLeaderboard } from "@/components/trains/PriceIsRightPodiumLeaderboard";
import { PriceIsRightTicketsPanel } from "@/components/trains/PriceIsRightTicketsPanel";
import { TodayConductorCard } from "@/components/trains/TodayConductorCard";
import { WeekTemplateChangeDialog } from "@/components/trains/WeekTemplateChangeDialog";
import { DayMechanismPickerDialog } from "@/components/trains/DayMechanismPickerDialog";
import { WeekTemplatePickerDialog } from "@/components/trains/WeekTemplatePickerDialog";
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
import { TrainMonthCalendar } from "@/components/trains/TrainMonthCalendar";
import { DAY_PAINT_TEMPLATES } from "@/lib/trains/paint-templates.shared";
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
  isAutomaticTopNBoard,
  resolveConductorTopNBoard,
} from "@/lib/trains/conductor-top-n.shared";
import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";
import {
  conductorSpinSource,
  isPoolSpinSource,
  vipSpinSource,
} from "@/lib/trains/spin-source.shared";
import { canStartConductorSwap } from "@/lib/trains/conductor-swap.shared";
import { currentGuidedStep } from "@/lib/trains/guided-flow.shared";
import { rosterSyncCapabilityAllowsInPageSync } from "@/lib/trains/roster-data-status.shared";
import { buildTrainsGuidedVideoUploadHref } from "@/lib/trains/guided-video-upload.shared";
import type { PoolRefreshedInfo, PoolType, RollResult, WeekTemplateType } from "@/lib/trains/types";
import {
  compositeParentForSegment,
  isWeekTemplateSegment,
} from "@/lib/trains/week-template-registry.shared";
import {
  formatTrainPointCount,
  type MemberQualificationPayload,
} from "@/lib/trains/train-conductor-minimums.shared";
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
import {
  hasValidConductorPickForDay,
} from "@/lib/trains/conductor-mechanism.shared";
import { supportsManualConductorPick, supportsManualVipPick } from "@/lib/trains/templates";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
  weekDatesInTrainWeek,
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

function inferWeekTemplateFromDayConfigs(
  dayConfigs: Array<{ paintTemplate?: WeekTemplateType | null }>,
): WeekTemplateType {
  if (dayConfigs.length === 0) return "vs_push_week";

  const counts = new Map<WeekTemplateType, number>();
  for (const day of dayConfigs) {
    let key = day.paintTemplate ?? "vs_push_week";
    // Draft dayConfigs use segment paint templates (e.g. vs_push_weekdays).
    // Map those back to selectable composite parents so the template picker
    // can show a detail panel for the inferred selection.
    if (isWeekTemplateSegment(key)) {
      key = compositeParentForSegment(key) ?? key;
    }
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
  const locale = useLocale();
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
  const [wheelBlockedRole, setWheelBlockedRole] = useState<
    "conductor" | "vip"
  >("conductor");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [dayMechanismPickerOpen, setDayMechanismPickerOpen] = useState(false);
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
  const [rollingRole, setRollingRole] = useState<"conductor" | "vip" | null>(
    null,
  );
  const [reseedingPool, setReseedingPool] = useState<PoolType | null>(null);
  const [conductorLockBusy, setConductorLockBusy] = useState<
    "lock" | "unlock" | null
  >(null);
  const [clearWeekOpen, setClearWeekOpen] = useState(false);
  const [clearWeekBusy, setClearWeekBusy] = useState(false);
  const [pendingPastPaint, setPendingPastPaint] = useState<{
    dates: string[];
    templateType: WeekTemplateType;
    topN?: number;
  } | null>(null);
  const [pastPaintBusy, setPastPaintBusy] = useState(false);
  const [autoRollNotice, setAutoRollNotice] = useState<{
    date: string;
    memberName: string;
    role: "conductor" | "vip";
  } | null>(null);
  const [rosterSyncBusy, setRosterSyncBusy] = useState(false);
  const [rosterSyncNotice, setRosterSyncNotice] = useState<string | null>(null);
  const [rosterSyncNoticeTone, setRosterSyncNoticeTone] = useState<
    "success" | "warning" | "error"
  >("success");

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

  const handleWeekLoadError = useCallback(
    (_message?: string) => {
      setError(t("weekLoadFailed"));
    },
    [t],
  );

  const handleWeightingEnabledChange = useCallback(
    async (nextWeightingEnabled: boolean) => {
      const previous = data.priceIsRightWeightingEnabled;
      if (previous === nextWeightingEnabled) return;
      setData((prev) => ({
        ...prev,
        priceIsRightWeightingEnabled: nextWeightingEnabled,
      }));
      try {
        const res = await fetch("/api/trains/price-is-right/weighting", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weightingEnabled: nextWeightingEnabled }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setData((prev) => ({
            ...prev,
            priceIsRightWeightingEnabled: previous,
          }));
          setError(body.error ?? t("scheduleFailed"));
          return;
        }
        setError(null);
      } catch {
        setData((prev) => ({
          ...prev,
          priceIsRightWeightingEnabled: previous,
        }));
        setError(t("scheduleFailed"));
      }
    },
    [data.priceIsRightWeightingEnabled, t],
  );

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
      vs_top_n: t("mechanismsShort.vsTopN"),
      vr_top_n: t("mechanismsShort.vrTopN"),
      r3_lottery: t("mechanismsShort.r3Lottery"),
      heavy_hitter_lottery: t("mechanismsShort.heavyHitterLottery"),
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
      top_vs: t("templates.top_vs"),
      top_vr: t("templates.top_vr"),
      economy_week: t("templates.economy_week"),
      price_is_right: t("templates.price_is_right"),
      price_is_right_weekdays: t("templates.price_is_right_weekdays"),
      takedown_week: t("templates.takedown_week"),
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
      top_vs: t("templatesShort.top_vs"),
      top_vr: t("templatesShort.top_vr"),
      price_is_right: t("templatesShort.price_is_right"),
      price_is_right_weekdays: t("templatesShort.price_is_right_weekdays"),
      takedown_week: t("templatesShort.takedown_week"),
    }),
    [t],
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

  const handleRosterSync = useCallback(async () => {
    setRosterSyncBusy(true);
    setRosterSyncNotice(null);
    try {
      const res = await fetch("/api/trains/roster-sync", { method: "POST" });
      const body = (await res.json()) as {
        error?: string;
        synced?: number;
        activeMemberCount?: number;
        rosterDataStatus?: TrainsDashboardPayload["rosterDataStatus"];
      };
      if (!res.ok) {
        const message = body.error ?? t("guidedFlow.steps.roster.syncFailed");
        setRosterSyncNoticeTone("error");
        setRosterSyncNotice(message);
        setError(message);
        return;
      }

      const syncSnapshot =
        body.rosterDataStatus != null && body.activeMemberCount != null
          ? {
              activeMemberCount: body.activeMemberCount,
              rosterDataStatus: body.rosterDataStatus,
            }
          : null;

      await refreshRef.current();

      if (syncSnapshot) {
        setData((current) => ({
          ...current,
          activeMemberCount: syncSnapshot.activeMemberCount,
          rosterDataStatus: syncSnapshot.rosterDataStatus,
        }));
      }

      const status = body.rosterDataStatus;
      const rankLabel =
        status?.poolType != null
          ? t(`guidedFlow.steps.roster.rankLabels.${status.poolType}`)
          : "";

      if (body.synced === 0 && (body.activeMemberCount ?? 0) === 0) {
        const message = t("guidedFlow.steps.roster.syncFailed");
        setRosterSyncNoticeTone("error");
        setRosterSyncNotice(message);
        setError(message);
        return;
      }

      if (status?.ready) {
        setRosterSyncNotice(
          t("guidedFlow.steps.roster.syncReady", {
            eligibleCount: status.eligiblePoolCount,
            rankLabel,
          }),
        );
        setRosterSyncNoticeTone("success");
        setError(null);
        return;
      }

      if ((body.activeMemberCount ?? 0) > 0 && status) {
        if (status.blockerKind === "conductor_minimums") {
          setRosterSyncNotice(
            t("guidedFlow.steps.roster.syncStillBlockedMinimums", {
              count: status.activeMemberCount,
              rankEligible: status.rankEligiblePoolCount,
              rankLabel,
            }),
          );
        } else if (status.blockerKind === "missing_rank_pool") {
          setRosterSyncNotice(
            t("guidedFlow.steps.roster.syncStillBlockedRanks", {
              count: status.activeMemberCount,
              rankLabel,
            }),
          );
        } else {
          setRosterSyncNotice(
            t("guidedFlow.steps.roster.syncSuccess", {
              count: body.activeMemberCount ?? 0,
            }),
          );
        }
        setRosterSyncNoticeTone("warning");
        setError(null);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("guidedFlow.steps.roster.syncFailed");
      setRosterSyncNoticeTone("error");
      setRosterSyncNotice(message);
      setError(message);
    } finally {
      setRosterSyncBusy(false);
    }
  }, [
    t,
    setData,
    setError,
    setRosterSyncBusy,
    setRosterSyncNotice,
    setRosterSyncNoticeTone,
  ]);

  // Revalidate dashboard data when the tab becomes visible again (e.g. after
  // uploading scores on /tools/video-upload and returning).
  useEffect(() => {
    const MIN_INTERVAL_MS = 5_000;
    let lastRefreshAt = 0;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshAt < MIN_INTERVAL_MS) return;
      lastRefreshAt = now;
      void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

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
    if (rollingRole || reseedingPool || conductorLockBusy) return;
    // Don't let page hotkeys / spin run "behind" open schedule dialogs.
    setTemplatePickerOpen(false);
    setError(null);
    setWheelBlocked(null);
    setRollingRole(role);
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
          setWheelBlockedRole(role);
          return;
        }
        setError(body.error ?? t("rollFailed"));
        return;
      }

      // Auto mechanisms (e.g. vs_high_score) skip the wheel. R4 sequence does not —
      // pick stays sequential; modal is still the celebratory spin.
      if (body.result.isAutomatic) {
        if (
          role === "conductor" &&
          body.result.qualification &&
          !body.result.qualification.qualified
        ) {
          pendingWheelRollRef.current = {
            date: selectedDate,
            role,
            result: body.result,
          };
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
    } finally {
      setRollingRole(null);
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
        setConductorDisqualified(null);
        void refreshRef.current();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("overrideFailed"));
      }
    },
    [applySnapshot, t],
  );

  const lockConductor = async () => {
    if (rollingRole || reseedingPool || conductorLockBusy) return;
    setConductorLockBusy("lock");
    try {
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
    } finally {
      setConductorLockBusy(null);
    }
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
    if (rollingRole || reseedingPool || conductorLockBusy) return;
    setUnlockConfirm(false);
    setConductorLockBusy("unlock");
    try {
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
    } finally {
      setConductorLockBusy(null);
    }
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
    (
      dates: string[],
      templateType: WeekTemplateType,
      options?: { updateWeekTemplate?: boolean; topN?: number },
    ) => {
      return withOptimisticMutation(
        (snap) =>
          applyOptimisticPaint(snap, dates, templateType, {
            updateWeekTemplate: options?.updateWeekTemplate,
            ...(options?.topN != null ? { topN: options.topN } : {}),
          }),
        async () => {
          const res = await fetch("/api/trains/schedule/days", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dates,
              templateType,
              updateWeekTemplate: options?.updateWeekTemplate === true,
              ...(options?.topN != null ? { topN: options.topN } : {}),
            }),
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
    (
      dates: string[],
      templateType: WeekTemplateType,
      options?: { updateWeekTemplate?: boolean; topN?: number },
    ) => {
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
          setPendingPastPaint({
            dates: allowedDates,
            templateType,
            ...(options?.topN != null ? { topN: options.topN } : {}),
          });
          return Promise.resolve(false);
        }
      }

      return executePaintDates(allowedDates, templateType, options);
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

      if (currentTemplate === templateType) {
        // Draft week: Simple Mode stays on the template step until the schedule
        // row exists. Re-confirming the preview template must persist it.
        if (!data.schedulePersisted && weekStart === data.weekStart) {
          const dates = weekDatesInTrainWeek(weekStart, trainWeekConfig).filter(
            (date) => date >= data.today,
          );
          if (dates.length > 0) {
            void paintDates(dates, templateType, { updateWeekTemplate: true });
          }
        }
        return;
      }

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
      data.schedulePersisted,
      data.today,
      data.weekStart,
      paintDates,
      setPendingTemplateChange,
      targetTrainWeekStart,
      trainWeekConfig,
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
      paintDates(options.dates, templateType, { updateWeekTemplate: true });
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
      ...DAY_PAINT_TEMPLATES.map((template, index) =>
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

  const reseedPool = async (
    poolType: PoolType,
    options?: { respin?: "conductor" | "vip" },
  ) => {
    if (rollingRole || reseedingPool || conductorLockBusy) return;
    setError(null);
    setReseedingPool(poolType);
    try {
      const res = await fetch("/api/trains/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolType, date: selectedDate }),
      });
      const body = (await res.json()) as TrainRollErrorResponse;
      if (!res.ok) {
        const blocked = parseTrainRollError(body);
        if (isWheelBlockedError(blocked)) {
          setWheelBlocked(blocked);
          if (options?.respin) setWheelBlockedRole(options.respin);
          return;
        }
        setError(body.error ?? t("poolFailed"));
        setWheelBlocked(null);
        return;
      }
      setWheelBlocked(null);
      void refreshRef.current();
      if (options?.respin) {
        setReseedingPool(null);
        await runRollRef.current(options.respin);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("poolFailed"));
      if (options?.respin) setWheelBlocked(null);
    } finally {
      setReseedingPool(null);
    }
  };

  const trainQuickActionBusy =
    rollingRole !== null || reseedingPool !== null || conductorLockBusy !== null;

  const locked = Boolean(selectedRecord?.lockedAt);
  const conductorPaint = selectedDayConfig?.paintTemplate;
  const conductorMech = effectiveConductorMechanism(
    selectedDayConfig?.conductorMechanism,
    conductorPaint,
    selectedDate,
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
  const rosterBlocking =
    Boolean(data.rosterDataStatus?.required) && !data.rosterDataStatus?.ready;
  const showQuickActions =
    data.canManageTrains &&
    (canRoll ||
      canManualPick ||
      canManualPickVip ||
      Boolean(selectedRecord?.conductorMemberId) ||
      locked ||
      rosterBlocking ||
      !data.schedulePersisted);
  const selectedConductorConfig =
    selectedDayConfig?.conductorConfig ??
    (selectedDayConfig?.topN != null
      ? { topN: selectedDayConfig.topN, paintTemplate: conductorPaint }
      : conductorPaint
        ? { paintTemplate: conductorPaint }
        : null);
  const selectedTopBoard = resolveConductorTopNBoard(
    selectedDayConfig?.conductorMechanism,
    selectedConductorConfig,
  );
  const hasValidConductor = hasValidConductorPickForDay({
    conductorMemberId: selectedRecord?.conductorMemberId,
    recordConductorMechanism: selectedRecord?.conductorMechanism,
    dayConductorMechanism: selectedDayConfig?.conductorMechanism,
    paintTemplate: conductorPaint,
    date: selectedDate,
    conductorConfig: selectedConductorConfig,
    topN: selectedDayConfig?.topN,
  });
  const canSpinConductorWheel =
    canRoll &&
    canSpinConductor(
      selectedDayConfig?.conductorMechanism,
      locked,
      conductorPaint,
      selectedDate,
      selectedConductorConfig,
    );
  const canSpinVipWheel = canRoll && canSpinVip(vipMech, locked);
  const guidedVipNeeded = Boolean(vipMech) && vipMech !== "none";
  const guidedHasVip = Boolean(selectedRecord?.vipMemberId);
  const guidedStep = currentGuidedStep({
    hasConductor: hasValidConductor,
    vipNeeded: guidedVipNeeded,
    hasVip: guidedHasVip,
    locked,
    rosterDataRequired:
      selectedDate === data.today ? data.rosterDataStatus?.required : false,
    rosterDataReady:
      selectedDate === data.today ? data.rosterDataStatus?.ready : true,
    vsDataRequired:
      selectedDate === data.today ? data.vsDataStatus?.required : false,
    vsDataReady:
      selectedDate === data.today ? data.vsDataStatus?.ready : true,
    conductorManualPickAvailable: canManualPick,
  });
  const showConductorCard =
    !data.simpleModeEnabled || guidedStep === "done";
  const selectedConductorSpinSource = conductorSpinSource(
    selectedDayConfig?.conductorMechanism,
    conductorPaint,
    selectedDate,
    selectedConductorConfig,
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
  const nextInSequence = useMemo(() => {
    if (
      !isPoolSpinSource(selectedConductorSpinSource) ||
      selectedConductorSpinSource.poolType !== "r4_plus"
    ) {
      return null;
    }
    return data.pools.r4_plus?.nextInSequence ?? null;
  }, [data.pools.r4_plus?.nextInSequence, selectedConductorSpinSource]);
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

  const rosterRankLabel =
    data.rosterDataStatus?.poolType != null
      ? t(`guidedFlow.steps.roster.rankLabels.${data.rosterDataStatus.poolType}`)
      : null;
  const rosterBannerBodyKey =
    data.rosterDataStatus?.blockerKind === "conductor_minimums"
      ? "guidedFlow.steps.roster.bodyConductorMinimums"
      : data.rosterDataStatus?.blockerKind === "missing_rank_pool"
        ? "rosterSyncBanner.bodyMissingRanks"
        : data.rosterDataStatus?.activeMemberCount === 0
          ? "rosterSyncBanner.bodyEmpty"
          : "rosterSyncBanner.bodyEmpty";
  const canInPageRosterSync =
    data.rosterDataStatus != null &&
    rosterSyncCapabilityAllowsInPageSync(data.rosterDataStatus.syncCapability);
  const canOfferRosterSync =
    canInPageRosterSync &&
    (data.rosterDataStatus?.blockerKind === "empty_roster" ||
      data.rosterDataStatus?.blockerKind === "missing_rank_pool");
  const showRosterBannerSync = canOfferRosterSync;
  const showWheelRosterSync =
    canOfferRosterSync ||
    (canInPageRosterSync &&
      wheelBlocked?.code === "POOL_EMPTY" &&
      (wheelBlocked.poolType === "r3" ||
        wheelBlocked.poolType === "r4_plus"));
  const guidedVideoUploadHref = useMemo(
    () =>
      buildTrainsGuidedVideoUploadHref({
        trainDate: data.today,
        vsDataStatus: data.vsDataStatus,
      }),
    [data.today, data.vsDataStatus],
  );

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
              simpleModeEnabled={data.simpleModeEnabled}
              canEdit
              onPreferencesChange={({
                displayWeekStartDow: nextDow,
                wheelSpinSpeed: nextSpeed,
                simpleModeEnabled: nextSimpleModeEnabled,
              }) => {
                setData((current) => ({
                  ...current,
                  displayWeekStartDow: nextDow,
                  wheelSpinSpeed: nextSpeed,
                  simpleModeEnabled: nextSimpleModeEnabled,
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
              <button
                type="button"
                id="trains-week-template-select"
                disabled={!data.canManageTrains}
                aria-labelledby="trains-week-template-label"
                aria-haspopup="dialog"
                aria-expanded={templatePickerOpen}
                data-testid="trains-week-template-button"
                onClick={() => setTemplatePickerOpen(true)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-hq-border bg-hq-surface px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0 truncate font-medium">
                  {templateLabels[activeWeekTemplate]}
                </span>
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-hq-fg-muted"
                  aria-hidden
                />
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {error ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger"
          role="alert"
          data-testid="trains-error-banner"
        >
          <p className="min-w-0 flex-1">{error}</p>
          <button
            type="button"
            className="shrink-0 text-xs underline opacity-80 hover:opacity-100"
            onClick={() => setError(null)}
          >
            {t("errorBanner.dismiss")}
          </button>
        </div>
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

      {showPlanWeekBanner ? (
        <TrainPlanWeekBanner
          onChooseTemplate={() => setTemplatePickerOpen(true)}
        />
      ) : null}

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

          {data.simpleModeEnabled &&
          scheduleView === "week" &&
          data.canManageTrains ? (
            <p
              className="text-xs text-hq-fg-muted"
              data-testid="trains-day-template-hold-hint"
            >
              {t("dayTemplateMenu.holdHint")}
            </p>
          ) : null}

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
              templateLabels={templateLabels}
              canPaintDays={data.canManageTrains}
              isDatePaintable={(date) =>
                data.canUnlockConductor ||
                canOfficerChangeTemplateForDate(date, data.today)
              }
              vrReporterCount={data.vrReporterCount}
              onPaintDate={(date, template, options) => {
                void paintDates([date], template, options);
              }}
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
              onWeekLoadError={handleWeekLoadError}
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
              vrReporterCount={data.vrReporterCount}
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

          {showConductorCard ? (
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
          ) : null}

          {isPriceIsRightPaintTemplate(conductorPaint) ? (
            <PriceIsRightPodiumLeaderboard trainDate={selectedDate} />
          ) : null}

          {isPriceIsRightPaintTemplate(conductorPaint) ? (
            <PriceIsRightTicketsPanel trainDate={selectedDate} />
          ) : null}

          {/* Quick actions */}
          {showQuickActions ? (
            data.simpleModeEnabled ? (
              <>
              <TrainsGuidedConductorFlow
                templateType={activeWeekTemplate}
                paintTemplate={conductorPaint}
                vsDataStatus={
                  selectedDate === data.today ? data.vsDataStatus : null
                }
                rosterDataStatus={
                  selectedDate === data.today ? data.rosterDataStatus : null
                }
                hasConductor={hasValidConductor}
                conductorName={selectedRecord?.conductorMemberName}
                vipNeeded={guidedVipNeeded}
                hasVip={guidedHasVip}
                vipName={selectedRecord?.vipMemberName}
                locked={locked}
                canRoll={canRoll}
                canManualPick={canManualPick}
                canManualPickVip={canManualPickVip}
                canSpinConductorWheel={canSpinConductorWheel}
                canSpinVipWheel={canSpinVipWheel}
                conductorMech={conductorMech}
                vipMech={vipMech}
                busy={trainQuickActionBusy}
                onChangeTemplate={() => setDayMechanismPickerOpen(true)}
                onRollConductor={() => void runRoll("conductor")}
                onPickTopScorer={() => void runRoll("conductor")}
                onPickConductorManual={() => {
                  setPickRole("conductor");
                  setPickOpen(true);
                }}
                onRollVip={() => void runRoll("vip")}
                onPickVipManual={() => {
                  setPickRole("vip");
                  setPickOpen(true);
                }}
                onLock={() => {
                  if (data.trainDiscordConfigured) {
                    setTrainReadyConfirm(true);
                    return;
                  }
                  void lockConductor();
                }}
                rosterSyncBusy={rosterSyncBusy}
                rosterSyncNotice={rosterSyncNotice}
                rosterSyncNoticeTone={rosterSyncNoticeTone}
                onSyncRoster={() => void handleRosterSync()}
                poolPanel={
                  isPoolSpinSource(selectedConductorSpinSource) ||
                  isPoolSpinSource(selectedVipSpinSource) ? (
                    <TrainSpinSourcePanel
                      conductorSource={selectedConductorSpinSource}
                      vipSource={selectedVipSpinSource}
                      pools={data.pools}
                      showConductorSpin={isPoolSpinSource(
                        selectedConductorSpinSource,
                      )}
                      showVipSpin={isPoolSpinSource(selectedVipSpinSource)}
                      onViewPool={openPoolDetails}
                    />
                  ) : null
                }
                advancedActions={
                  <>
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
                      onWheelBlocked={(details) => {
                        setWheelBlocked(details);
                        setWheelBlockedRole("conductor");
                      }}
                      onRefresh={refresh}
                    />
                    {canStartConductorSwap(selectedRecord) &&
                    spinWeekContext.dayConfigs.some(
                      (day) => day.date !== selectedDate,
                    ) ? (
                      <button
                        type="button"
                        onClick={() => setSwapOpen(true)}
                        className="rounded-lg border border-[#8957e5]/50 bg-[#8957e5]/10 px-4 py-2 text-sm font-medium text-[#d2a8ff] hover:bg-[#8957e5]/20 w-full sm:w-auto"
                      >
                        {t("swap.action")}
                      </button>
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
                            disabled={trainQuickActionBusy}
                            onClick={() => void unlockConductor()}
                            className="rounded-md bg-hq-danger-emphasis px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-danger disabled:opacity-50"
                          >
                            {conductorLockBusy === "unlock"
                              ? t("unlocking")
                              : t("unlockConfirmAction")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={trainQuickActionBusy}
                          onClick={() => setUnlockConfirm(true)}
                          className="rounded-lg border border-hq-danger-emphasis/60 bg-hq-danger-emphasis/10 px-4 py-2 text-sm font-medium text-hq-danger hover:bg-hq-danger-emphasis/20 disabled:opacity-50"
                        >
                          {conductorLockBusy === "unlock"
                            ? t("unlocking")
                            : t("unlockConductor")}
                        </button>
                      )
                    ) : null}
                    {!isPriceIsRightPaintTemplate(conductorPaint) &&
                    (conductorMech === "r3_lottery" ||
                      conductorMech === "heavy_hitter_lottery" ||
                      conductorMech === "r4_sequence") ? (
                      <div className="flex items-center gap-1.5 self-start">
                        <button
                          type="button"
                          disabled={trainQuickActionBusy}
                          onClick={() =>
                            void reseedPool(
                              conductorMech === "r3_lottery"
                                ? "r3"
                                : conductorMech === "heavy_hitter_lottery"
                                  ? "heavy_hitter"
                                  : "r4_plus",
                            )
                          }
                          className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:text-hq-fg disabled:opacity-50"
                        >
                          {reseedingPool ? t("reseedingPool") : t("reseedPool")}
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
                  </>
                }
                videoUploadHref={guidedVideoUploadHref}
              />
              {trainReadyConfirm &&
              data.trainDiscordConfigured &&
              !locked &&
              hasValidConductor ? (
                <div className="mt-3 flex w-full flex-wrap items-center gap-2 rounded-lg border border-hq-success/40 bg-hq-success/10 px-3 py-2">
                  <span className="text-sm text-hq-green">
                    {t("trainIsReady.confirm", {
                      name: selectedRecord?.conductorMemberName ?? "—",
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
                    disabled={trainQuickActionBusy}
                    onClick={() => {
                      setTrainReadyConfirm(false);
                      void lockConductor();
                    }}
                    className="rounded-md bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
                  >
                    {conductorLockBusy === "lock"
                      ? t("locking")
                      : t("trainIsReady.confirmAction")}
                  </button>
                </div>
              ) : null}
              </>
            ) : (
            <div
              className="flex flex-col gap-3 border-t border-hq-border pt-4"
              data-testid="trains-quick-actions"
            >
              <h3 className="text-sm font-medium text-hq-fg-muted">
                {t("quickActions")}
              </h3>
              {selectedDate === data.today &&
              rosterBlocking &&
              !locked ? (
                <div
                  className="flex flex-col gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5"
                  data-testid="trains-roster-sync-banner"
                >
                  <p className="text-sm text-hq-fg">
                    {t(rosterBannerBodyKey, {
                      rankLabel: rosterRankLabel ?? "",
                    })}
                  </p>
                  {showRosterBannerSync ? (
                    <button
                      type="button"
                      disabled={rosterSyncBusy}
                      onClick={() => void handleRosterSync()}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50 sm:w-auto"
                    >
                      {rosterSyncBusy
                        ? t("guidedFlow.steps.roster.syncing")
                        : data.rosterDataStatus?.syncCapability === "native_reload"
                          ? t("guidedFlow.steps.roster.refreshNative")
                          : t("guidedFlow.steps.roster.syncAshed")}
                    </button>
                  ) : (
                    <Link
                      href="/members"
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 sm:w-auto"
                    >
                      {t("guidedFlow.steps.roster.goToMembers")} →
                    </Link>
                  )}
                </div>
              ) : null}
              {selectedDate === data.today &&
              canSpinConductorWheel &&
              !canManualPick &&
              data.vsDataStatus?.required &&
              !data.vsDataStatus.ready &&
              !locked ? (
                <div
                  className="flex flex-col gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5"
                  data-testid="trains-upload-scores-banner"
                >
                  <p className="text-sm text-hq-fg">
                    {t("uploadScoresBanner.body")}
                  </p>
                  <Link
                    href={guidedVideoUploadHref}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 sm:w-auto"
                  >
                    {t("uploadScoresBanner.link")}
                  </Link>
                </div>
              ) : null}
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
                  onWheelBlocked={(details) => {
                    setWheelBlocked(details);
                    setWheelBlockedRole("conductor");
                  }}
                  onRefresh={refresh}
                />
                {canRoll && canSpinConductorWheel ? (
                  <button
                    type="button"
                    disabled={trainQuickActionBusy}
                    onClick={() => void runRoll("conductor")}
                    className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0] disabled:opacity-50 w-full sm:w-auto"
                  >
                    {rollingRole === "conductor"
                      ? t("spinning")
                      : conductorMech === "r4_sequence" && nextInSequence
                        ? t("assignNextInSequence", {
                            name: nextInSequence.memberName,
                          })
                        : t("spinWheel")}
                  </button>
                ) : null}
                {canRoll &&
                (isAutomaticTopNBoard(selectedTopBoard) ||
                  conductorMech === "donations_top") ? (
                  <button
                    type="button"
                    disabled={locked || trainQuickActionBusy}
                    onClick={() => void runRoll("conductor")}
                    className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50 w-full sm:w-auto"
                  >
                    {rollingRole === "conductor" ? t("spinning") : t("pickTopScorer")}
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
                    disabled={trainQuickActionBusy}
                    onClick={() => void runRoll("vip")}
                    className="rounded-lg bg-[#bf8700] px-4 py-2 text-sm font-medium text-white hover:bg-[#d29922] disabled:opacity-50 w-full sm:w-auto"
                  >
                    {rollingRole === "vip" ? t("spinning") : t("spinVipWheel")}
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
                {!locked && hasValidConductor ? (
                  data.trainDiscordConfigured ? (
                    trainReadyConfirm ? (
                      <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-hq-success/40 bg-hq-success/10 px-3 py-2">
                        <span className="text-sm text-hq-green">
                          {t("trainIsReady.confirm", {
                            name: selectedRecord?.conductorMemberName ?? "—",
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
                          disabled={trainQuickActionBusy}
                          onClick={() => {
                            setTrainReadyConfirm(false);
                            void lockConductor();
                          }}
                          className="rounded-md bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
                        >
                          {conductorLockBusy === "lock"
                            ? t("locking")
                            : t("trainIsReady.confirmAction")}
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
                      disabled={trainQuickActionBusy}
                      onClick={() => void lockConductor()}
                      className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50 w-full sm:w-auto"
                    >
                      {conductorLockBusy === "lock"
                        ? t("locking")
                        : t("lockConductor")}
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
                        disabled={trainQuickActionBusy}
                        onClick={() => void unlockConductor()}
                        className="rounded-md bg-hq-danger-emphasis px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-danger disabled:opacity-50"
                      >
                        {conductorLockBusy === "unlock"
                          ? t("unlocking")
                          : t("unlockConfirmAction")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={trainQuickActionBusy}
                      onClick={() => setUnlockConfirm(true)}
                      className="rounded-lg border border-hq-danger-emphasis/60 bg-hq-danger-emphasis/10 px-4 py-2 text-sm font-medium text-hq-danger hover:bg-hq-danger-emphasis/20 disabled:opacity-50"
                    >
                      {conductorLockBusy === "unlock"
                        ? t("unlocking")
                        : t("unlockConductor")}
                    </button>
                  )
                ) : null}
              </div>

              {!isPriceIsRightPaintTemplate(conductorPaint) &&
              (conductorMech === "r3_lottery" ||
                conductorMech === "heavy_hitter_lottery" ||
                conductorMech === "r4_sequence") ? (
                <div className="flex items-center gap-1.5 self-start">
                  <button
                    type="button"
                    disabled={trainQuickActionBusy}
                    onClick={() =>
                      void reseedPool(
                        conductorMech === "r3_lottery"
                          ? "r3"
                          : conductorMech === "heavy_hitter_lottery"
                            ? "heavy_hitter"
                            : "r4_plus",
                      )
                    }
                    className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:text-hq-fg disabled:opacity-50"
                  >
                    {reseedingPool
                      ? t("reseedingPool")
                      : t("reseedPool")}
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
            )
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
        members={
          pickRole === "conductor" && conductorPaint === "r3_recognition"
            ? data.roster.filter((member) => member.allianceRank === 3)
            : data.roster
        }
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
          if (!open) {
            setConductorDisqualified(null);
            pendingWheelRollRef.current = null;
          }
        }}
        title={t("wheel.disqualifiedTitle")}
      >
        {conductorDisqualified?.qualification ? (
          <div className="flex flex-col gap-4">
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
                    score: formatTrainPointCount(
                      conductorDisqualified.qualification.vs.score,
                      locale,
                    ),
                    required: formatTrainPointCount(
                      conductorDisqualified.qualification.vs.effectiveMinimum,
                      locale,
                    ),
                    shortfall: formatTrainPointCount(
                      conductorDisqualified.qualification.vs.shortfall,
                      locale,
                    ),
                  })}
                </p>
              ) : null}
              {conductorDisqualified.qualification.donation.minimum > 0 ? (
                <p className="text-xs text-hq-fg-muted">
                  {t("wheel.donationShortfall", {
                    score: formatTrainPointCount(
                      conductorDisqualified.qualification.donation.score,
                      locale,
                    ),
                    required: formatTrainPointCount(
                      conductorDisqualified.qualification.donation
                        .effectiveMinimum,
                      locale,
                    ),
                    shortfall: formatTrainPointCount(
                      conductorDisqualified.qualification.donation.shortfall,
                      locale,
                    ),
                  })}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setConductorDisqualified(null);
                  pendingWheelRollRef.current = null;
                }}
                className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
              >
                {t("autoDq.close")}
              </button>
              {canManualPick ? (
                <button
                  type="button"
                  onClick={() => {
                    setConductorDisqualified(null);
                    pendingWheelRollRef.current = null;
                    setPickRole("conductor");
                    setPickOpen(true);
                  }}
                  className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface"
                >
                  {t("autoDq.pickManually")}
                </button>
              ) : null}
              <button
                type="button"
                disabled={trainQuickActionBusy}
                onClick={() => {
                  setConductorDisqualified(null);
                  pendingWheelRollRef.current = null;
                  void runRollRef.current("conductor");
                }}
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {t("autoDq.spinAgain")}
              </button>
              <button
                type="button"
                disabled={trainQuickActionBusy}
                onClick={() => void handleWheelOverride("")}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
              >
                {t("autoDq.override")}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <WheelBlockedDialog
        open={wheelBlocked != null}
        details={wheelBlocked}
        fallbackPoolType={
          wheelBlockedRole === "vip" &&
          isPoolSpinSource(selectedVipSpinSource)
            ? selectedVipSpinSource.poolType
            : isPoolSpinSource(selectedConductorSpinSource)
              ? selectedConductorSpinSource.poolType
              : isPoolSpinSource(selectedVipSpinSource)
                ? selectedVipSpinSource.poolType
                : null
        }
        busy={reseedingPool != null || rosterSyncBusy}
        rosterSyncBusy={rosterSyncBusy}
        rosterSyncNotice={rosterSyncNotice}
        rosterSyncNoticeTone={rosterSyncNoticeTone}
        canPickManually={
          wheelBlockedRole === "vip" ? canManualPickVip : canManualPick
        }
        onClose={() => {
          if (reseedingPool == null && !rosterSyncBusy) {
            setWheelBlocked(null);
            setRosterSyncNotice(null);
          }
        }}
        onReseedAndRespin={(poolType) =>
          void reseedPool(poolType, { respin: wheelBlockedRole })
        }
        onPickManually={() => {
          setPickRole(wheelBlockedRole);
          setPickOpen(true);
        }}
        onRetrySpin={() => void runRollRef.current(wheelBlockedRole)}
        canSyncRoster={showWheelRosterSync}
        onSyncRoster={() => void handleRosterSync()}
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

      <DayMechanismPickerDialog
        key={
          dayMechanismPickerOpen
            ? `day-mechanism-picker:open:${conductorPaint ?? activeWeekTemplate}:${data.today}`
            : "day-mechanism-picker:closed"
        }
        open={dayMechanismPickerOpen}
        currentTemplate={(conductorPaint ?? activeWeekTemplate) as WeekTemplateType}
        date={data.today}
        weekStart={targetTrainWeekStart}
        vrReporterCount={data.vrReporterCount}
        disabled={!data.canManageTrains}
        weightingEnabled={data.priceIsRightWeightingEnabled}
        onWeightingEnabledChange={handleWeightingEnabledChange}
        onClose={() => setDayMechanismPickerOpen(false)}
        onSelect={(templateType, topN) => {
          setDayMechanismPickerOpen(false);
          void paintDates(
            [data.today],
            templateType,
            topN != null ? { topN } : undefined,
          );
        }}
      />

      <WeekTemplatePickerDialog
        key={
          templatePickerOpen
            ? `template-picker:open:${activeWeekTemplate}`
            : "template-picker:closed"
        }
        open={templatePickerOpen}
        currentTemplate={activeWeekTemplate}
        weekStart={targetTrainWeekStart}
        disabled={!data.canManageTrains}
        weightingEnabled={data.priceIsRightWeightingEnabled}
        onWeightingEnabledChange={handleWeightingEnabledChange}
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={(templateType) => {
          setTemplatePickerOpen(false);
          handleTemplateClick(templateType);
        }}
      />

      <WeekTemplateChangeDialog
        key={
          pendingTemplateChange
            ? `template-change:${pendingTemplateChange.weekStart}:${pendingTemplateChange.templateType}`
            : "template-change:closed"
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
              {
                updateWeekTemplate: true,
                ...(pendingPastPaint.topN != null
                  ? { topN: pendingPastPaint.topN }
                  : {}),
              },
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

      {hasValidConductor && selectedRecord ? (
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
