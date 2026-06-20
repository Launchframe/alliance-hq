"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ConductorPickModal } from "@/components/trains/ConductorPickModal";
import { ConductorHistoryTable } from "@/components/trains/ConductorHistoryTable";
import { ConductorWheelModal } from "@/components/trains/ConductorWheelModal";
import { TodayConductorCard } from "@/components/trains/TodayConductorCard";
import { WeekTemplateChangeDialog } from "@/components/trains/WeekTemplateChangeDialog";
import { WheelBlockedDialog } from "@/components/trains/WheelBlockedDialog";
import {
  TrainPoolDetailsDialog,
  type PoolDetailsOption,
} from "@/components/trains/TrainPoolDetailsDialog";
import { TrainSpinSourcePanel } from "@/components/trains/TrainSpinSourcePanel";
import { TrainMonthCalendar } from "@/components/trains/TrainMonthCalendar";
import { TemplatePaletteBadge, TemplatePaletteOptionLabel } from "@/components/trains/TemplatePaletteBadge";
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
import { getMonthKey, getWeekStartMonday, addCalendarDays, monthEndFromKey, monthStartFromKey, isCalendarDateOnOrAfter } from "@/lib/trains/game-time";
import type {
  MonthSchedulePagePayload,
  TrainsDashboardPayload,
  WeekSchedulePagePayload,
} from "@/lib/trains/load-dashboard";
import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import {
  conductorSpinSource,
  dayNeedsAshedConnection,
  isPoolSpinSource,
  vipSpinSource,
} from "@/lib/trains/spin-source.shared";
import type { PoolRefreshedInfo, PoolType, WeekTemplateType } from "@/lib/trains/types";
import { SELECTABLE_WEEK_TEMPLATES } from "@/lib/trains/week-template-registry.shared";
import {
  applyOptimisticConductorPick,
  applyOptimisticConductorRoll,
  applyOptimisticLock,
  applyOptimisticPaint,
  applyOptimisticUnlock,
  applyOptimisticWeekTemplate,
  type TrainsDashboardSnapshot,
} from "@/lib/trains/optimistic-dashboard.shared";
import {
  isWheelBlockedError,
  parseTrainRollError,
  type TrainRollErrorDetails,
  type TrainRollErrorResponse,
} from "@/lib/trains/roll-errors.shared";
import {
  latestLockedDateInWeek,
  weekHasPersistedSchedule,
} from "@/lib/trains/week-template-change.shared";
import { supportsManualConductorPick, supportsManualVipPick } from "@/lib/trains/templates";

type Props = {
  initial: TrainsDashboardPayload;
};

type RollResponse = TrainRollErrorResponse & {
  result?: {
    memberId: string;
    memberName: string;
    isAutomatic?: boolean;
    wheelCandidates?: Array<{ memberId: string; memberName: string }>;
    poolRefreshed?: PoolRefreshedInfo;
  };
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
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
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
    cutoffDate: string;
  } | null>(null);
  const [poolDetailsOpen, setPoolDetailsOpen] = useState(false);
  const [poolDetailsInitialType, setPoolDetailsInitialType] =
    useState<PoolType | null>(null);

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
    const pending = pendingWheelRollRef.current;
    pendingWheelRollRef.current = null;
    if (!pending) return;

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
    void fetchWeek(getWeekStartMonday(today));
  }, [data.today, fetchMonth, fetchWeek, scheduleView]);

  const isOnTodayView = useMemo(() => {
    if (selectedDate !== data.today) return false;
    if (scheduleView === "month") {
      return viewedMonth.monthKey === getMonthKey(data.today);
    }
    return viewedWeek.weekStart === getWeekStartMonday(data.today);
  }, [
    data.today,
    scheduleView,
    selectedDate,
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
      void fetchWeek(getWeekStartMonday(selectedDateRef.current));
    },
    [fetchMonth, fetchWeek],
  );

  const selectedWeekStart = getWeekStartMonday(selectedDate);
  const selectedWeekEnd = addCalendarDays(selectedWeekStart, 6);
  const weekViewSeed = useMemo((): WeekSchedulePagePayload => {
    if (viewedWeek.weekStart === selectedWeekStart) {
      return viewedWeek;
    }
    const dayConfigs = viewedMonth.dayConfigs.filter(
      (day) => day.date >= selectedWeekStart && day.date <= selectedWeekEnd,
    );
    const weekRecords = viewedMonth.monthRecords.filter(
      (record) => record.date >= selectedWeekStart && record.date <= selectedWeekEnd,
    );
    if (dayConfigs.length === 0) {
      return buildProvisionalWeekPage(selectedWeekStart, viewedWeek.templateType);
    }
    const seed = {
      weekStart: selectedWeekStart,
      weekEnd: selectedWeekEnd,
      templateType: viewedWeek.templateType,
      dayConfigs,
      weekRecords,
    };
    return seed;
  }, [selectedWeekStart, selectedWeekEnd, viewedWeek, viewedMonth]);

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
    if (viewedWeek.templateType) {
      return viewedWeek.templateType;
    }
    if (viewedWeek.weekStart === data.weekStart && data.schedule?.templateType) {
      return data.schedule.templateType as WeekTemplateType;
    }
    return inferWeekTemplateFromDayConfigs(viewedWeek.dayConfigs);
  }, [data.schedule, data.weekStart, viewedWeek]);

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
      setWheelOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rollFailed"));
    }
  };

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

  const paintDates = useCallback(
    (dates: string[], templateType: WeekTemplateType) => {
      void withOptimisticMutation(
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

  const applyWeekTemplate = useCallback(
    async (
      templateType: WeekTemplateType,
      weekStart: string,
      preserveThroughDate: string | null,
    ) => {
      await withOptimisticMutation(
        (snap) =>
          applyOptimisticWeekTemplate(
            snap,
            weekStart,
            templateType,
            preserveThroughDate,
          ),
        async () => {
          const res = await fetch("/api/trains/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateType, weekStart }),
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

  const handleTemplateClick = useCallback(
    (templateType: WeekTemplateType) => {
      const { weekStart, weekEnd, weekRecords } = viewedWeek;
      const hasPersistedSchedule = weekHasPersistedSchedule(
        data.schedule,
        weekStart,
        viewedWeek.dayConfigs,
      );
      const currentTemplate = hasPersistedSchedule
        ? viewedWeek.templateType ??
          (weekStart === data.weekStart && data.schedule
            ? (data.schedule.templateType as WeekTemplateType)
            : inferWeekTemplateFromDayConfigs(viewedWeek.dayConfigs))
        : null;

      if (currentTemplate === templateType) return;

      const cutoffDate = latestLockedDateInWeek(
        weekRecords,
        weekStart,
        weekEnd,
      );

      if (!cutoffDate) {
        void applyWeekTemplate(templateType, weekStart, null);
        return;
      }

      setPendingTemplateChange({
        templateType,
        weekStart,
        cutoffDate,
      });
    },
    [applyWeekTemplate, data.schedule, data.weekStart, viewedWeek, setPendingTemplateChange],
  );

  const confirmPendingTemplateChange = useCallback(() => {
    if (!pendingTemplateChange) return;
    const { templateType, weekStart, cutoffDate } = pendingTemplateChange;
    setPendingTemplateChange(null);
    void applyWeekTemplate(templateType, weekStart, cutoffDate);
  }, [applyWeekTemplate, pendingTemplateChange, setPendingTemplateChange]);

  const openPoolDetails = useCallback((poolType: PoolType) => {
    setPoolDetailsInitialType(poolType);
    setPoolDetailsOpen(true);
  }, [setPoolDetailsInitialType, setPoolDetailsOpen]);

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
  const canManualPick =
    !locked &&
    supportsManualConductorPick(conductorMech) &&
    isCalendarDateOnOrAfter(selectedDate, data.today);
  const canManualPickVip =
    !locked &&
    supportsManualVipPick(vipMech) &&
    isCalendarDateOnOrAfter(selectedDate, data.today);
  const dayIsActionable = isCalendarDateOnOrAfter(selectedDate, data.today);
  const selectedConductorSpinSource = conductorSpinSource(
    selectedDayConfig?.conductorMechanism,
    conductorPaint,
  );
  const selectedVipSpinSource = vipSpinSource(vipMech);
  const showConductorSpinButton = canSpinConductor(
    selectedDayConfig?.conductorMechanism,
    locked,
    conductorPaint,
  );
  const showConductorTopScorer =
    conductorMech === "vs_high_score" || conductorMech === "donations_top";
  const showConductorReseed =
    conductorMech === "r3_lottery" || conductorMech === "r4_sequence";
  const showConductorLock = !locked && Boolean(selectedRecord?.conductorMemberId);
  const showConductorUnlock = locked && data.canUnlockConductor;
  const showConductorQuickSection =
    selectedConductorSpinSource != null ||
    showConductorSpinButton ||
    showConductorTopScorer ||
    canManualPick ||
    showConductorLock ||
    showConductorUnlock ||
    showConductorReseed;
  const showVipSpinButton = canSpinVip(vipMech, locked);
  const showVipQuickSection =
    selectedVipSpinSource != null || showVipSpinButton || canManualPickVip;
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
  const showNativeAshedBanner =
    data.operatingMode === "native" &&
    dayNeedsAshedConnection(conductorMech, vipMech, conductorPaint);
  const historyMechanismLabels = useMemo(
    () => ({ ...conductorShortLabels, ...vipShortLabels }),
    [conductorShortLabels, vipShortLabels],
  );

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

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </div>
        {data.canManageTrains ||
        data.schedule ||
        viewedWeek.dayConfigs.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[15rem]">
            <span
              id="trains-week-template-label"
              className="text-[10px] font-medium uppercase tracking-wide text-[#8b949e]"
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
              triggerClassName="rounded-xl border-[#30363d] bg-[#161b22]"
              className="w-full"
            />
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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => goToToday()}
              disabled={isOnTodayView}
              aria-label={t("goToTodayAria")}
              className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-xs font-medium text-[#e6edf3] hover:bg-[#161b22] disabled:cursor-default disabled:opacity-50"
            >
              {t("goToToday")}
            </button>
          </div>

          {scheduleView === "week" ? (
            <WeekScheduleStrip
              today={data.today}
              initialWeekStart={weekViewSeed.weekStart}
              initialWeekEnd={weekViewSeed.weekEnd}
              initialDayConfigs={weekViewSeed.dayConfigs}
              initialWeekRecords={weekViewSeed.weekRecords}
              selectedDate={selectedDate}
              conductorLabels={conductorShortLabels}
              vipLabels={vipShortLabels}
              templateShortLabels={templateShortLabels}
              navLabels={{
                previousWeek: t("weekNavPrevious"),
                nextWeek: t("weekNavNext"),
                previousDay: t("dayNavPrevious"),
                nextDay: t("dayNavNext"),
              }}
              externalWeek={
                viewedWeek.weekStart === selectedWeekStart
                  ? viewedWeek
                  : weekViewSeed
              }
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
          />

          {showNativeAshedBanner ? (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {t("nativeAshedBanner")}
            </p>
          ) : null}

          {/* Quick actions */}
          {data.canManageTrains &&
          dayIsActionable &&
          (showConductorQuickSection || showVipQuickSection) ? (
            <div className="flex flex-col gap-4 border-t border-[#30363d] pt-4">
              {showConductorQuickSection ? (
                <section
                  className="flex flex-col gap-2"
                  aria-labelledby="trains-quick-actions-conductor"
                >
                  <h3
                    id="trains-quick-actions-conductor"
                    className="text-sm font-medium text-[#c9d1d9]"
                  >
                    {t("quickActionsConductor")}
                  </h3>
                  <TrainSpinSourcePanel
                    role="conductor"
                    conductorSource={selectedConductorSpinSource}
                    vipSource={selectedVipSpinSource}
                    pools={data.pools}
                    showConductorSpin={selectedConductorSpinSource != null}
                    showVipSpin={false}
                    onViewPool={openPoolDetails}
                  />
                  <div className="flex flex-wrap gap-2">
                    {showConductorSpinButton ? (
                      <button
                        type="button"
                        onClick={() => void runRoll("conductor")}
                        className="w-full rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0] sm:w-auto"
                      >
                        {conductorMech === "r4_sequence" && nextInSequence
                          ? t("assignNextInSequence", {
                              name: nextInSequence.memberName,
                            })
                          : t("spinWheel")}
                      </button>
                    ) : null}
                    {showConductorTopScorer ? (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => void runRoll("conductor")}
                        className="w-full rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 sm:w-auto"
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
                        className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#161b22] sm:w-auto"
                      >
                        {t("pickConductorManually")}
                      </button>
                    ) : null}
                    {showConductorLock ? (
                      <button
                        type="button"
                        onClick={() => void lockConductor()}
                        className="w-full rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] sm:w-auto"
                      >
                        {t("lockConductor")}
                      </button>
                    ) : null}
                    {showConductorUnlock ? (
                      unlockConfirm ? (
                        <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-[#da3633]/40 bg-[#da3633]/10 px-3 py-2">
                          <span className="text-sm text-[#f85149]">
                            {t("unlockConfirm")}
                          </span>
                          <button
                            type="button"
                            onClick={() => setUnlockConfirm(false)}
                            className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#0d1117]"
                          >
                            {t("unlockCancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void unlockConductor()}
                            className="rounded-md bg-[#da3633] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#f85149]"
                          >
                            {t("unlockConfirmAction")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setUnlockConfirm(true)}
                          className="w-full rounded-lg border border-[#da3633]/60 bg-[#da3633]/10 px-4 py-2 text-sm font-medium text-[#f85149] hover:bg-[#da3633]/20 sm:w-auto"
                        >
                          {t("unlockConductor")}
                        </button>
                      )
                    ) : null}
                  </div>
                  {showConductorReseed ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void reseedPool(
                            conductorMech === "r3_lottery" ? "r3" : "r4_plus",
                          )
                        }
                        className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3]"
                      >
                        {t("reseedPool")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReseedHintOpen(true)}
                        aria-label={t("reseedPoolHint.infoLabel")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8b949e] hover:bg-[#0d1117] hover:text-[#e6edf3]"
                      >
                        <Info className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {showVipQuickSection ? (
                <section
                  className="flex flex-col gap-2"
                  aria-labelledby="trains-quick-actions-vip"
                >
                  <h3
                    id="trains-quick-actions-vip"
                    className="text-sm font-medium text-[#c9d1d9]"
                  >
                    {t("quickActionsVip")}
                  </h3>
                  <TrainSpinSourcePanel
                    role="vip"
                    conductorSource={selectedConductorSpinSource}
                    vipSource={selectedVipSpinSource}
                    pools={data.pools}
                    showConductorSpin={false}
                    showVipSpin={selectedVipSpinSource != null}
                    onViewPool={openPoolDetails}
                  />
                  <div className="flex flex-wrap gap-2">
                    {showVipSpinButton ? (
                      <button
                        type="button"
                        onClick={() => void runRoll("vip")}
                        className="w-full rounded-lg bg-[#bf8700] px-4 py-2 text-sm font-medium text-white hover:bg-[#d29922] sm:w-auto"
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
                        className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#161b22] sm:w-auto"
                      >
                        {t("pickVipManually")}
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : data.canManageTrains ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-dashed border-[#30363d] bg-[#161b22]/50 px-4 py-4"
          aria-labelledby="trains-choose-template-heading"
        >
          <div>
            <h2
              id="trains-choose-template-heading"
              className="text-sm font-medium text-[#c9d1d9]"
            >
              {t("chooseTemplateTitle")}
            </h2>
            <p className="mt-1 text-sm text-[#8b949e]">{t("noScheduleYet")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_OPTIONS.map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => handleTemplateClick(template)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs font-medium text-[#e6edf3] hover:bg-[#161b22]"
              >
                <TemplatePaletteBadge template={template} shape="square" />
                {templateLabels[template]}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22]/40 px-4 py-3 text-sm text-[#8b949e]">
          {t("noScheduleReadOnly")}
        </section>
      )}

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
        onClose={handleWheelClose}
      />

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
        open={pendingTemplateChange != null}
        templateType={pendingTemplateChange?.templateType ?? null}
        cutoffDate={pendingTemplateChange?.cutoffDate ?? null}
        onConfirm={confirmPendingTemplateChange}
        onClose={() => setPendingTemplateChange(null)}
      />

      <Dialog
        open={reseedHintOpen}
        onOpenChange={setReseedHintOpen}
        title={t("reseedPoolHint.title")}
      >
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#e6edf3]">
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
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
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
              <h2 className="text-lg font-semibold text-[#e6edf3]">
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
              <p className="mt-2 text-sm text-[#8b949e]">
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
                className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
              >
                {t("poolRefreshedHint.close")}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
