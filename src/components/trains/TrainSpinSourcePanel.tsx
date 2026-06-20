"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { SpinSource } from "@/lib/trains/spin-source.shared";
import { isPoolSpinSource } from "@/lib/trains/spin-source.shared";
import type { PoolType } from "@/lib/trains/types";

type PoolSummary = {
  generation: number;
  total: number;
  remaining: number;
  exhausted: boolean;
  nextInSequence?: { memberId: string; memberName: string } | null;
};

type Props = {
  conductorSource: SpinSource;
  vipSource: SpinSource;
  pools: Record<string, PoolSummary | undefined>;
  showConductorSpin: boolean;
  showVipSpin: boolean;
  onViewPool: (poolType: PoolType) => void;
  /** When set, render only that role's spin source row (no panel heading). */
  role?: "conductor" | "vip";
};

function sourceLabel(
  source: SpinSource,
  t: ReturnType<typeof useTranslations<"trains.spinSource">>,
): string | null {
  if (!source) return null;
  switch (source.kind) {
    case "pool":
      return t(`poolTypes.${source.poolType}`);
    case "vs_leaderboard":
      return source.topN === 1
        ? t("vsLeaderboardTop1")
        : t("vsLeaderboardTopN", { count: source.topN });
    case "donations_leaderboard":
      return source.rank === 1
        ? t("donationsLeaderboardTop")
        : t("donationsLeaderboardSecond");
    case "event_leaderboard":
      return t("eventLeaderboard");
    default:
      return null;
  }
}

function SpinSourceRow({
  roleLabel,
  source,
  poolSummary,
  onViewPool,
  showRoleLabel = true,
}: {
  roleLabel: string;
  source: SpinSource;
  poolSummary?: PoolSummary;
  onViewPool: (poolType: PoolType) => void;
  showRoleLabel?: boolean;
}) {
  const t = useTranslations("trains.spinSource");
  const label = sourceLabel(source, t);
  if (!label) return null;

  const isPool = isPoolSpinSource(source);

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[#30363d] bg-[#0d1117]/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {showRoleLabel ? (
          <div className="text-[10px] font-medium uppercase tracking-wide text-[#8b949e]">
            {roleLabel}
          </div>
        ) : null}
        <div
          className={`text-sm font-medium text-[#e6edf3] ${showRoleLabel ? "mt-0.5" : ""}`}
        >
          {label}
        </div>
        {isPool && poolSummary ? (
          <div className="mt-1 text-xs text-[#8b949e]">
            {poolSummary.total === 0
              ? t("poolNotSeeded")
              : t("poolRemaining", {
                  remaining: poolSummary.remaining,
                  total: poolSummary.total,
                  generation: poolSummary.generation,
                })}
            {poolSummary.nextInSequence ? (
              <span className="mt-0.5 block text-[#c9d1d9]">
                {t("nextInSequence", {
                  name: poolSummary.nextInSequence.memberName,
                })}
              </span>
            ) : null}
            {poolSummary.exhausted ? (
              <span className="ml-1 text-[#d29922]">{t("poolExhausted")}</span>
            ) : null}
          </div>
        ) : null}
        {isPool && !poolSummary ? (
          <div className="mt-1 text-xs text-[#8b949e]">{t("poolNotSeeded")}</div>
        ) : null}
        {!isPool ? (
          <div className="mt-1 text-xs text-[#8b949e]">{t("liveLeaderboardHint")}</div>
        ) : null}
      </div>
      {isPool ? (
        <button
          type="button"
          onClick={() => onViewPool(source.poolType)}
          className="shrink-0 rounded-md border border-[#30363d] px-3 py-1.5 text-xs font-medium text-[#e6edf3] hover:bg-[#161b22] w-full sm:w-auto"
        >
          {t("viewPool")}
        </button>
      ) : null}
    </div>
  );
}

export function TrainSpinSourcePanel({
  conductorSource,
  vipSource,
  pools,
  showConductorSpin,
  showVipSpin,
  onViewPool,
  role,
}: Props) {
  const t = useTranslations("trains.spinSource");

  const rows: ReactNode[] = [];

  const showConductor = role == null || role === "conductor";
  const showVip = role == null || role === "vip";

  if (showConductor && showConductorSpin && conductorSource) {
    rows.push(
      <SpinSourceRow
        key="conductor"
        roleLabel={t("conductorRole")}
        source={conductorSource}
        poolSummary={
          isPoolSpinSource(conductorSource)
            ? pools[conductorSource.poolType]
            : undefined
        }
        onViewPool={onViewPool}
        showRoleLabel={role == null}
      />,
    );
  }

  if (showVip && showVipSpin && vipSource) {
    rows.push(
      <SpinSourceRow
        key="vip"
        roleLabel={t("vipRole")}
        source={vipSource}
        poolSummary={
          isPoolSpinSource(vipSource) ? pools[vipSource.poolType] : undefined
        }
        onViewPool={onViewPool}
        showRoleLabel={role == null}
      />,
    );
  }

  if (rows.length === 0) return null;

  if (role != null) {
    return <div className="flex flex-col gap-2">{rows}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
        {t("heading")}
      </h4>
      {rows}
    </div>
  );
}
