"use client";

import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";

import { ConductorWheelModal } from "@/components/trains/ConductorWheelModal";
import { SpinWeekConfirmDialog } from "@/components/trains/SpinWeekConfirmDialog";
import {
  applyOptimisticConductorRoll,
  type TrainsDashboardSnapshot,
} from "@/lib/trains/optimistic-dashboard.shared";
import {
  isWheelBlockedError,
  parseTrainRollError,
  type TrainRollErrorDetails,
} from "@/lib/trains/roll-errors.shared";
import type { PoolRefreshedInfo, RollResult } from "@/lib/trains/types";
import type { MemberQualificationPayload } from "@/lib/trains/train-conductor-minimums.shared";
import {
  spinWeekDayLabel,
  spinWheelDatesForRestOfWeek,
  type SpinWeekDayConfig,
  type SpinWeekDayRecord,
  type SpinWeekResultRow,
} from "@/lib/trains/spin-week.shared";

const MAX_DISQUALIFIED_RETRIES = 10;

type RollResponse = {
  result?: RollResult;
  stats?: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  };
  error?: string;
};

type Props = {
  weekStart: string;
  weekEnd: string;
  today: string;
  dayConfigs: SpinWeekDayConfig[];
  weekRecords: SpinWeekDayRecord[];
  canManageTrains: boolean;
  canSpinViewedWeek: boolean;
  wheelSpeedMultiplier?: number;
  snapshotRef: RefObject<TrainsDashboardSnapshot>;
  applySnapshot: (next: TrainsDashboardSnapshot) => void;
  presentPoolRefreshedHints: (items: PoolRefreshedInfo[]) => void;
  onError: (message: string) => void;
  /** Surface structured wheel/pool blocks with recovery CTAs on the dashboard. */
  onWheelBlocked?: (details: TrainRollErrorDetails) => void;
  onRefresh: () => void;
};

type FlowPhase = "idle" | "spinning" | "confirm";

export function SpinWeekConductorFlow({
  weekStart,
  weekEnd,
  today,
  dayConfigs,
  weekRecords,
  canManageTrains,
  canSpinViewedWeek,
  wheelSpeedMultiplier = 1,
  snapshotRef,
  applySnapshot,
  presentPoolRefreshedHints,
  onError,
  onWheelBlocked,
  onRefresh,
}: Props) {
  const t = useTranslations("trains.spinWeek");
  const [phase, setPhase] = useState<FlowPhase>("idle");
  const [confirmResults, setConfirmResults] = useState<SpinWeekResultRow[]>([]);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelCandidates, setWheelCandidates] = useState<
    Array<{ memberId: string; memberName: string; priorDayVsScore?: number }>
  >([]);
  const [wheelWinner, setWheelWinner] = useState<{
    memberId: string;
    memberName: string;
    priorDayVsScore?: number;
  } | null>(null);
  const [wheelMechanism, setWheelMechanism] = useState<string | null>(null);
  const [wheelStats, setWheelStats] = useState<RollResponse["stats"] | null>(
    null,
  );
  const [wheelQualification, setWheelQualification] =
    useState<MemberQualificationPayload | null>(null);
  const [wheelDayLabel, setWheelDayLabel] = useState<string | null>(null);

  const pendingRollRef = useRef<{
    date: string;
    result: RollResult;
  } | null>(null);
  const wheelDoneRef = useRef<(() => void) | null>(null);
  const abortRef = useRef(false);

  const eligibleDates = useMemo(
    () =>
      spinWheelDatesForRestOfWeek({
        today,
        weekStart,
        weekEnd,
        dayConfigs,
        weekRecords,
      }),
    [today, weekStart, weekEnd, dayConfigs, weekRecords],
  );

  const disabled =
    !canSpinViewedWeek || eligibleDates.length === 0 || phase !== "idle";
  const disabledReason = !canSpinViewedWeek
    ? t("disabledReason.pastWeek")
    : eligibleDates.length === 0
      ? t("disabledReason.noEligibleDays")
      : null;

  const waitForWheel = useCallback(
    () =>
      new Promise<void>((resolve) => {
        wheelDoneRef.current = resolve;
      }),
    [],
  );

  const rollConductorForDate = useCallback(async (date: string) => {
    const res = await fetch("/api/trains/conductor/roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "conductor", date }),
    });
    return (await res.json()) as RollResponse;
  }, []);

  const rollUntilQualified = useCallback(
    async (date: string) => {
      for (let attempt = 0; attempt < MAX_DISQUALIFIED_RETRIES; attempt += 1) {
        const body = await rollConductorForDate(date);
        if (!body.result) {
          const blocked = parseTrainRollError(body);
          if (isWheelBlockedError(blocked)) {
            const err = new Error(body.error ?? t("rollFailed")) as Error & {
              wheelBlocked?: TrainRollErrorDetails;
            };
            err.wheelBlocked = blocked;
            throw err;
          }
          throw new Error(body.error ?? t("rollFailed"));
        }
        if (
          !body.result.qualification ||
          body.result.qualification.qualified
        ) {
          return body;
        }
      }
      throw new Error(t("disqualifiedExhausted"));
    },
    [rollConductorForDate, t],
  );

  const handleAutomatedRevealComplete = useCallback(() => {
    const pending = pendingRollRef.current;
    if (pending && pending.result.draftPersisted !== false) {
      applySnapshot(
        applyOptimisticConductorRoll(
          snapshotRef.current,
          pending.date,
          "conductor",
          pending.result,
        ),
      );
      if (pending.result.poolRefreshed) {
        presentPoolRefreshedHints([pending.result.poolRefreshed]);
      }
    }
    setWheelOpen(false);
    setWheelQualification(null);
    pendingRollRef.current = null;
    wheelDoneRef.current?.();
    wheelDoneRef.current = null;
  }, [applySnapshot, presentPoolRefreshedHints, snapshotRef]);

  const startSpinWeek = useCallback(async () => {
    if (eligibleDates.length === 0 || phase !== "idle") return;

    abortRef.current = false;
    setPhase("spinning");
    const accumulated: SpinWeekResultRow[] = [];

    try {
      for (const date of eligibleDates) {
        if (abortRef.current) break;

        const body = await rollUntilQualified(date);
        const result = body.result;
        if (!result) continue;

        pendingRollRef.current = { date, result };
        setWheelCandidates(
          result.wheelCandidates?.length
            ? result.wheelCandidates
            : [{ memberId: result.memberId, memberName: result.memberName }],
        );
        setWheelWinner(result);
        setWheelMechanism(result.mechanism);
        setWheelStats(body.stats ?? null);
        setWheelQualification(result.qualification ?? null);
        setWheelDayLabel(spinWeekDayLabel(date));
        setWheelOpen(true);

        await waitForWheel();

        accumulated.push({
          date,
          dayLabel: spinWeekDayLabel(date),
          memberId: result.memberId,
          memberName: result.memberName,
        });
      }

      if (abortRef.current || accumulated.length === 0) {
        setPhase("idle");
        return;
      }

      setConfirmResults(accumulated);
      setPhase("confirm");
    } catch (error) {
      setWheelOpen(false);
      setWheelQualification(null);
      pendingRollRef.current = null;
      setPhase("idle");
      const wheelBlocked =
        error instanceof Error
          ? (error as Error & { wheelBlocked?: TrainRollErrorDetails })
              .wheelBlocked
          : undefined;
      if (wheelBlocked && onWheelBlocked) {
        onWheelBlocked(wheelBlocked);
        return;
      }
      onError(error instanceof Error ? error.message : t("rollFailed"));
    }
  }, [
    eligibleDates,
    onError,
    onWheelBlocked,
    phase,
    rollUntilQualified,
    t,
    waitForWheel,
  ]);

  const dismissConfirm = useCallback(() => {
    setConfirmResults([]);
    setPhase("idle");
    void onRefresh();
  }, [onRefresh]);

  if (!canManageTrains && phase === "idle") {
    return null;
  }

  return (
    <>
      {canManageTrains ? (
        <button
          type="button"
          disabled={disabled}
          title={disabled && disabledReason ? disabledReason : undefined}
          data-testid="trains-spin-week-btn"
          onClick={() => void startSpinWeek()}
          className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0] disabled:cursor-not-allowed disabled:opacity-60 w-full sm:w-auto"
        >
          {phase === "spinning"
            ? t("spinningProgress", { count: eligibleDates.length })
            : t("spinForWeek")}
        </button>
      ) : null}

      <ConductorWheelModal
        open={wheelOpen}
        candidates={wheelCandidates}
        winner={wheelWinner}
        stats={wheelStats ?? null}
        qualification={wheelQualification}
        dayLabel={wheelDayLabel}
        mechanism={wheelMechanism}
        speedMultiplier={wheelSpeedMultiplier}
        automated
        onAutomatedRevealComplete={handleAutomatedRevealComplete}
        onClose={handleAutomatedRevealComplete}
      />

      <SpinWeekConfirmDialog
        open={phase === "confirm"}
        results={confirmResults}
        onClose={dismissConfirm}
      />
    </>
  );
}
