"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import type { PoolType } from "@/lib/trains/types";

type PoolSummary = {
  generation: number;
  total: number;
  remaining: number;
  exhausted: boolean;
};

type PoolEntryRow = {
  id: string;
  memberId: string;
  memberName: string;
  allianceRank: number | null;
  sequencePosition: number | null;
  selectedAt: string | null;
  selectedForDate: string | null;
  vsScore?: number | null;
};

type EventPoolContext = {
  scoreDate: string;
  vsDayNumber: number | null;
  vsDayKey: string | null;
};

type PoolPayload = {
  summary: PoolSummary;
  entries: PoolEntryRow[];
  eventContext?: EventPoolContext | null;
  error?: string;
};

export type PoolDetailsOption = {
  role: "conductor" | "vip";
  poolType: PoolType;
};

type MemberTab = "eligible" | "chosen";

type Props = {
  open: boolean;
  options: PoolDetailsOption[];
  initialPoolType: PoolType | null;
  trainDate: string | null;
  onClose: () => void;
};

function tabButtonClass(active: boolean): string {
  return `rounded-md px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "bg-[#161b22] text-[#e6edf3]"
      : "text-[#8b949e] hover:text-[#e6edf3]"
  }`;
}

function resolveInitialPoolType(
  open: boolean,
  options: PoolDetailsOption[],
  initialPoolType: PoolType | null,
): PoolType | null {
  if (!open) return null;
  const fallback = options[0]?.poolType ?? null;
  if (
    initialPoolType &&
    options.some((option) => option.poolType === initialPoolType)
  ) {
    return initialPoolType;
  }
  return fallback;
}

export function TrainPoolDetailsDialog({
  open,
  options,
  initialPoolType,
  trainDate,
  onClose,
}: Props) {
  const t = useTranslations("trains.poolDetails");
  const [poolSwitch, setPoolSwitch] = useState<PoolType | null>(null);
  const [memberTab, setMemberTab] = useState<MemberTab>("eligible");
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<PoolPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const defaultPoolType = useMemo(
    () => resolveInitialPoolType(open, options, initialPoolType),
    [initialPoolType, open, options],
  );
  const activePoolType = poolSwitch ?? defaultPoolType;

  const activeOption = useMemo(
    () => options.find((option) => option.poolType === activePoolType) ?? null,
    [activePoolType, options],
  );

  useEffect(() => {
    if (!open || !activePoolType) {
      return;
    }

    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        setLoading(true);
        setFetchError(null);
        try {
          const params = new URLSearchParams({
            poolType: activePoolType,
          });
          if (activePoolType === "event_top_x" && trainDate) {
            params.set("date", trainDate);
          }
          const res = await fetch(`/api/trains/pool?${params.toString()}`);
          const body = (await res.json()) as PoolPayload;
          if (cancelled) return;
          if (!res.ok) {
            setFetchError(body.error ?? t("loadFailed"));
            setPayload(null);
            return;
          }
          setPayload(body);
        } catch {
          if (!cancelled) {
            setFetchError(t("loadFailed"));
            setPayload(null);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [activePoolType, open, t, trainDate]);

  const handleClose = useCallback(() => {
    setPoolSwitch(null);
    setMemberTab("eligible");
    setPayload(null);
    setFetchError(null);
    onClose();
  }, [onClose]);

  const filteredEntries = useMemo(() => {
    if (!payload) return [];
    const rows = payload.entries.filter((entry) =>
      memberTab === "eligible" ? !entry.selectedAt : Boolean(entry.selectedAt),
    );
    const sortByScore =
      activePoolType === "event_top_x" &&
      rows.some((entry) => entry.vsScore != null);
    if (memberTab === "chosen") {
      return [...rows].sort((a, b) => {
        if (sortByScore) {
          return (b.vsScore ?? -1) - (a.vsScore ?? -1);
        }
        const aTime = a.selectedAt ? Date.parse(a.selectedAt) : 0;
        const bTime = b.selectedAt ? Date.parse(b.selectedAt) : 0;
        return bTime - aTime;
      });
    }
    if (sortByScore) {
      return [...rows].sort((a, b) => (b.vsScore ?? -1) - (a.vsScore ?? -1));
    }
    return rows;
  }, [activePoolType, memberTab, payload]);

  const eventContextLine = useMemo(() => {
    const ctx = payload?.eventContext;
    if (!ctx?.vsDayKey || ctx.vsDayNumber == null) return null;
    const dayName = t(
      `vsWeekDays.${ctx.vsDayKey}` as
        | "vsWeekDays.radarTraining"
        | "vsWeekDays.baseExpansion"
        | "vsWeekDays.ageOfScience"
        | "vsWeekDays.heroDay"
        | "vsWeekDays.totalMobilization"
        | "vsWeekDays.busterDay",
    );
    return t("eventScoreContext", {
      dayNumber: ctx.vsDayNumber,
      dayName,
      scoreDate: ctx.scoreDate.slice(5),
    });
  }, [payload?.eventContext, t]);

  const showEventScores = activePoolType === "event_top_x";

  const poolTitleKey = activePoolType
    ? (`poolTypes.${activePoolType}` as const)
    : null;

  const roleLabel =
    activeOption?.role === "vip"
      ? t("vipPool")
      : activeOption?.role === "conductor"
        ? t("conductorPool")
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      title={poolTitleKey ? t(poolTitleKey) : t("title")}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3]">
            {poolTitleKey ? t(poolTitleKey) : t("title")}
          </h2>
          {roleLabel ? (
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-[#8b949e]">
              {roleLabel}
            </p>
          ) : null}
          {eventContextLine ? (
            <p className="mt-2 text-sm text-[#c9d1d9]">{eventContextLine}</p>
          ) : null}
          {payload ? (
            <p className="mt-1 text-sm text-[#8b949e]">
              {t("summaryLine", {
                remaining: payload.summary.remaining,
                total: payload.summary.total,
                generation: payload.summary.generation,
              })}
              {payload.summary.exhausted ? (
                <span className="ml-1 text-[#d29922]">{t("exhausted")}</span>
              ) : null}
            </p>
          ) : null}
        </div>

        {options.length > 1 ? (
          <div
            className="inline-flex w-full rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5 sm:w-auto"
            role="tablist"
            aria-label={t("poolSwitcherLabel")}
          >
            {options.map((option) => (
              <button
                key={`${option.role}-${option.poolType}`}
                type="button"
                role="tab"
                aria-selected={activePoolType === option.poolType}
                onClick={() => {
                  setPoolSwitch(option.poolType);
                  setMemberTab("eligible");
                }}
                className={`min-w-0 flex-1 sm:flex-initial ${tabButtonClass(
                  activePoolType === option.poolType,
                )}`}
              >
                {option.role === "vip" ? t("vipPool") : t("conductorPool")}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="inline-flex w-full rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5 sm:w-auto"
          role="tablist"
          aria-label={t("memberTabsLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={memberTab === "eligible"}
            onClick={() => setMemberTab("eligible")}
            className={`min-w-0 flex-1 sm:flex-initial ${tabButtonClass(
              memberTab === "eligible",
            )}`}
          >
            {t("tabEligible")}
            {payload ? (
              <span className="ml-1 tabular-nums text-[#8b949e]">
                ({payload.summary.remaining})
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={memberTab === "chosen"}
            onClick={() => setMemberTab("chosen")}
            className={`min-w-0 flex-1 sm:flex-initial ${tabButtonClass(
              memberTab === "chosen",
            )}`}
          >
            {t("tabChosen")}
            {payload ? (
              <span className="ml-1 tabular-nums text-[#8b949e]">
                ({payload.summary.total - payload.summary.remaining})
              </span>
            ) : null}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[#8b949e]">{t("loading")}</p>
        ) : null}

        {fetchError ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {fetchError}
          </p>
        ) : null}

        {!loading && payload && filteredEntries.length === 0 ? (
          <p className="text-sm text-[#8b949e]">
            {payload.summary.total === 0
              ? t("emptyUnseeded")
              : memberTab === "eligible"
                ? t("emptyEligible")
                : t("emptyChosen")}
          </p>
        ) : null}

        {!loading && filteredEntries.length > 0 ? (
          <ul className="max-h-[min(50vh,24rem)] space-y-2 overflow-y-auto">
            {filteredEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[#30363d] bg-[#0d1117]/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[#e6edf3]">
                    {entry.sequencePosition != null && !showEventScores ? (
                      <span className="mr-2 tabular-nums text-[#8b949e]">
                        #{entry.sequencePosition}
                      </span>
                    ) : null}
                    {entry.memberName}
                  </div>
                  {entry.allianceRank != null ? (
                    <div className="text-xs text-[#8b949e]">
                      {t("rankLabel", { rank: entry.allianceRank })}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  {showEventScores ? (
                    <span className="font-mono text-sm tabular-nums text-[#e6edf3]">
                      {entry.vsScore != null
                        ? t("scorePoints", { score: entry.vsScore })
                        : t("scoreUnavailable")}
                    </span>
                  ) : null}
                  {memberTab === "chosen" && entry.selectedForDate ? (
                    <span className="text-xs tabular-nums text-[#8b949e]">
                      {entry.selectedForDate.slice(5)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
