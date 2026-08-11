"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { ScoreLeaderboardPodium } from "@/components/trains/ScoreLeaderboardPodium";
import { Dialog } from "@/components/ui/dialog";
import { poolUsesSequenceDraw } from "@/lib/trains/pool-draw-mode.shared";
import {
  poolResetConfirmActionKey,
  poolResetConfirmBodyKey,
  poolResetTriggerLabelKey,
} from "@/lib/trains/pool-reset-copy.shared";
import type { ScoreLeaderboardKind } from "@/lib/trains/score-leaderboard-podium.shared";
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

type PriorGenerationSnapshot = {
  generation: number;
  total: number;
  picked: number;
  remaining: number;
  exhausted: boolean;
  unpickedMemberNames: string[];
};

type PoolPayload = {
  summary: PoolSummary;
  entries: PoolEntryRow[];
  priorGenerations?: PriorGenerationSnapshot[];
  eventContext?: EventPoolContext | null;
  error?: string;
};

export type PoolDetailsOption = {
  role: "conductor" | "vip";
  poolType: PoolType;
};

export type EligibilityPickMember = {
  memberId: string;
  memberName: string;
};

type MemberTab = "eligible" | "chosen";

type Props = {
  open: boolean;
  options: PoolDetailsOption[];
  initialPoolType: PoolType | null;
  trainDate: string | null;
  scoreLeaderboardKind?: ScoreLeaderboardKind | null;
  canResetPool?: boolean;
  resetBusy?: boolean;
  onResetPool?: () => void;
  onOpenReseedHint?: () => void;
  /** Manual conductor pick from the eligible (unpicked) list. */
  canPickConductor?: boolean;
  pickBusy?: boolean;
  onPickConductor?: (member: EligibilityPickMember) => void;
  onClose: () => void;
};

function tabButtonClass(active: boolean): string {
  return `rounded-md px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "bg-hq-surface text-hq-fg"
      : "text-hq-fg-muted hover:text-hq-fg"
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

export function TrainEligibilityDialog({
  open,
  options,
  initialPoolType,
  trainDate,
  scoreLeaderboardKind = null,
  canResetPool = false,
  resetBusy = false,
  onResetPool,
  onOpenReseedHint,
  canPickConductor = false,
  pickBusy = false,
  onPickConductor,
  onClose,
}: Props) {
  const t = useTranslations("trains.poolDetails");
  const tRoot = useTranslations("trains");
  const [poolSwitch, setPoolSwitch] = useState<PoolType | null>(null);
  const [memberTab, setMemberTab] = useState<MemberTab>("eligible");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<PoolPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [expandedPriorGeneration, setExpandedPriorGeneration] = useState<
    number | null
  >(null);

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
    setSearchQuery("");
    setPayload(null);
    setFetchError(null);
    setResetConfirm(false);
    setExpandedPriorGeneration(null);
    onClose();
  }, [onClose]);

  const showPoolList = options.length > 0 && activePoolType != null;
  const showScorePodium = scoreLeaderboardKind != null && trainDate != null;

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

  const visibleEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filteredEntries;
    return filteredEntries.filter((entry) =>
      entry.memberName.toLowerCase().includes(q),
    );
  }, [filteredEntries, searchQuery]);

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
  const usesSequenceDraw =
    activePoolType != null && poolUsesSequenceDraw(activePoolType);

  const chosenPickOrder = useMemo(() => {
    if (!payload || usesSequenceDraw) return new Map<string, number>();
    const chosen = payload.entries
      .filter((entry) => entry.selectedAt)
      .sort((a, b) => {
        const aDate = a.selectedForDate ?? "";
        const bDate = b.selectedForDate ?? "";
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        const aTime = a.selectedAt ? Date.parse(a.selectedAt) : 0;
        const bTime = b.selectedAt ? Date.parse(b.selectedAt) : 0;
        return aTime - bTime;
      });
    const order = new Map<string, number>();
    chosen.forEach((entry, index) => {
      order.set(entry.id, index + 1);
    });
    return order;
  }, [payload, usesSequenceDraw]);

  const roleLabel =
    activeOption?.role === "vip"
      ? t("vipPool")
      : activeOption?.role === "conductor"
        ? t("conductorPool")
        : null;

  const showPickActions =
    canPickConductor &&
    Boolean(onPickConductor) &&
    activeOption?.role === "conductor" &&
    memberTab === "eligible";

  const priorGenerations = payload?.priorGenerations ?? [];
  const resetConfirmBodyKey = payload
    ? poolResetConfirmBodyKey(payload.summary)
    : "resetConfirmBodyExhausted";
  const resetConfirmActionKey = payload
    ? poolResetConfirmActionKey(payload.summary)
    : "resetConfirmActionStartRotation";
  const resetTriggerLabelKey = payload
    ? poolResetTriggerLabelKey(payload.summary)
    : "startNewRotation";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      title={t("title")}
      className="flex min-h-0 max-h-[min(90dvh,720px)] max-w-lg flex-col overflow-hidden"
      data-testid="trains-eligibility-dialog"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="shrink-0 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
            {roleLabel && showPoolList ? (
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                {roleLabel}
              </p>
            ) : null}
            {eventContextLine ? (
              <p className="mt-2 text-sm text-hq-fg-muted">{eventContextLine}</p>
            ) : null}
            {payload && showPoolList ? (
              <p className="mt-1 text-sm text-hq-fg-muted">
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

          {priorGenerations.length > 0 ? (
            <div
              className="max-h-[min(28vh,12rem)] overflow-y-auto rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
              data-testid="trains-eligibility-prior-generations"
            >
              <p className="text-sm font-medium text-hq-fg">
                {t("priorGenerationsTitle")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-hq-fg-muted">
                {t("priorGenerationsHint")}
              </p>
              <ul className="mt-2 space-y-2">
                {priorGenerations.map((prior) => {
                  const expanded = expandedPriorGeneration === prior.generation;
                  return (
                    <li
                      key={prior.generation}
                      className="rounded-md border border-hq-border/80 bg-hq-canvas/40 px-2.5 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-hq-fg">
                          {t("priorGenerationSummary", {
                            generation: prior.generation,
                            picked: prior.picked,
                            remaining: prior.remaining,
                          })}
                        </p>
                        {prior.remaining > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPriorGeneration(
                                expanded ? null : prior.generation,
                              )
                            }
                            className="text-xs font-medium text-cyan-400 hover:text-cyan-300"
                          >
                            {expanded
                              ? t("priorGenerationHideUnpicked")
                              : t("priorGenerationShowUnpicked", {
                                  count: prior.remaining,
                                })}
                          </button>
                        ) : null}
                      </div>
                      {expanded && prior.unpickedMemberNames.length > 0 ? (
                        <p className="mt-2 text-xs leading-relaxed text-hq-fg-muted">
                          {prior.unpickedMemberNames.join(", ")}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {showScorePodium ? (
            <ScoreLeaderboardPodium
              trainDate={trainDate}
              kind={scoreLeaderboardKind}
            />
          ) : null}

          {showPoolList && options.length > 1 ? (
            <div
              className="inline-flex w-full rounded-lg border border-hq-border bg-hq-canvas p-0.5 sm:w-auto"
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
                    setSearchQuery("");
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

          {showPoolList ? (
            <div
              className="inline-flex w-full rounded-lg border border-hq-border bg-hq-canvas p-0.5 sm:w-auto"
              role="tablist"
              aria-label={t("memberTabsLabel")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={memberTab === "eligible"}
                onClick={() => {
                  setMemberTab("eligible");
                  setSearchQuery("");
                }}
                className={`min-w-0 flex-1 sm:flex-initial ${tabButtonClass(
                  memberTab === "eligible",
                )}`}
              >
                {t("tabEligible")}
                {payload ? (
                  <span className="ml-1 tabular-nums text-hq-fg-muted">
                    ({payload.summary.remaining})
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={memberTab === "chosen"}
                onClick={() => {
                  setMemberTab("chosen");
                  setSearchQuery("");
                }}
                className={`min-w-0 flex-1 sm:flex-initial ${tabButtonClass(
                  memberTab === "chosen",
                )}`}
              >
                {t("tabChosen")}
                {payload ? (
                  <span className="ml-1 tabular-nums text-hq-fg-muted">
                    ({payload.summary.total - payload.summary.remaining})
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}

          {showPoolList && !loading && filteredEntries.length > 0 ? (
            <label className="block">
              <span className="sr-only">{t("searchLabel")}</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  memberTab === "eligible"
                    ? t("searchEligiblePlaceholder")
                    : t("searchChosenPlaceholder")
                }
                className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg placeholder:text-hq-fg-muted"
                data-testid="trains-eligibility-search"
              />
            </label>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {showPoolList ? (
            <>
              {loading ? (
                <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
              ) : null}

              {fetchError ? (
                <p className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">
                  {fetchError}
                </p>
              ) : null}

              {!loading && payload && filteredEntries.length === 0 ? (
                <p className="text-sm text-hq-fg-muted">
                  {payload.summary.total === 0
                    ? t("emptyUnseeded")
                    : memberTab === "eligible"
                      ? t("emptyEligible")
                      : t("emptyChosen")}
                </p>
              ) : null}

              {!loading &&
              filteredEntries.length > 0 &&
              visibleEntries.length === 0 ? (
                <p className="text-sm text-hq-fg-muted">{t("searchEmpty")}</p>
              ) : null}

              {!loading && visibleEntries.length > 0 ? (
                <ul className="space-y-2 pb-1">
                  {visibleEntries.map((entry) => {
                    const listPosition = showEventScores
                      ? null
                      : usesSequenceDraw && entry.sequencePosition != null
                        ? entry.sequencePosition
                        : memberTab === "chosen"
                          ? chosenPickOrder.get(entry.id)
                          : null;

                    return (
                      <li
                        key={entry.id}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-hq-border bg-hq-canvas/60 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-hq-fg">
                            {listPosition != null ? (
                              <span className="mr-2 tabular-nums text-hq-fg-muted">
                                #{listPosition}
                              </span>
                            ) : null}
                            {entry.memberName}
                          </div>
                          {entry.allianceRank != null ? (
                            <div className="text-xs text-hq-fg-muted">
                              {t("rankLabel", { rank: entry.allianceRank })}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="flex flex-col items-end gap-0.5">
                            {showEventScores ? (
                              <span className="font-mono text-sm tabular-nums text-hq-fg">
                                {entry.vsScore != null
                                  ? t("scorePoints", { score: entry.vsScore })
                                  : t("scoreUnavailable")}
                              </span>
                            ) : null}
                            {memberTab === "chosen" && entry.selectedForDate ? (
                              <span className="text-xs tabular-nums text-hq-fg-muted">
                                {entry.selectedForDate.slice(5)}
                              </span>
                            ) : null}
                          </div>
                          {showPickActions ? (
                            <button
                              type="button"
                              disabled={pickBusy}
                              onClick={() =>
                                onPickConductor?.({
                                  memberId: entry.memberId,
                                  memberName: entry.memberName,
                                })
                              }
                              className="rounded-md border border-hq-border bg-hq-surface px-2.5 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
                              data-testid={`trains-eligibility-pick-${entry.memberId}`}
                            >
                              {t("pickMember")}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="shrink-0 space-y-3 border-t border-hq-border pt-3">
          {canResetPool && onResetPool ? (
            <div>
              {resetConfirm ? (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="text-sm text-hq-fg">
                    {t(resetConfirmBodyKey, {
                      generation: payload?.summary.generation ?? 1,
                      nextGeneration: (payload?.summary.generation ?? 1) + 1,
                      remaining: payload?.summary.remaining ?? 0,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={resetBusy}
                      onClick={() => setResetConfirm(false)}
                      className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-canvas"
                    >
                      {t("resetConfirmCancel")}
                    </button>
                    <button
                      type="button"
                      disabled={resetBusy}
                      onClick={() => {
                        onResetPool();
                        setResetConfirm(false);
                      }}
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                      data-testid="trains-eligibility-reset-confirm"
                    >
                      {resetBusy
                        ? tRoot("reseedingPool")
                        : t(resetConfirmActionKey)}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={resetBusy}
                    onClick={() => setResetConfirm(true)}
                    className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg-muted hover:text-hq-fg disabled:opacity-50"
                    data-testid="trains-eligibility-reset"
                  >
                    {resetBusy
                      ? tRoot("reseedingPool")
                      : tRoot(resetTriggerLabelKey)}
                  </button>
                  {onOpenReseedHint ? (
                    <button
                      type="button"
                      onClick={onOpenReseedHint}
                      aria-label={tRoot("reseedPoolHint.infoLabel")}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-hq-fg-muted hover:bg-hq-canvas hover:text-hq-fg"
                      data-testid="trains-eligibility-reset-hint"
                    >
                      <Info className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
            >
              {t("close")}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
