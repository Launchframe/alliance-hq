"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { formatPriceIsRightVsScore } from "@/lib/trains/train-price-is-right-tickets.shared";
import type { PriceIsRightLeaderboardEntry } from "@/lib/trains/price-is-right-leaderboard.shared";

type LeaderboardPayload = {
  trainDate: string;
  scoreDate: string;
  podium: PriceIsRightLeaderboardEntry[];
  entries: PriceIsRightLeaderboardEntry[];
};

type Props = {
  trainDate: string;
};

function formatScoreDay(scoreDate: string): string {
  return new Date(`${scoreDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

const PODIUM_STYLES = {
  1: {
    bar: "h-36 bg-gradient-to-t from-amber-600/90 via-amber-400/80 to-amber-200/30 border-amber-300/50",
    medal: "text-amber-200",
    rank: "1",
    ring: "ring-amber-300/60",
  },
  2: {
    bar: "h-28 bg-gradient-to-t from-slate-500/90 via-slate-300/70 to-slate-100/20 border-slate-300/40",
    medal: "text-slate-200",
    rank: "2",
    ring: "ring-slate-300/50",
  },
  3: {
    bar: "h-24 bg-gradient-to-t from-orange-700/90 via-orange-500/70 to-orange-200/20 border-orange-400/40",
    medal: "text-orange-200",
    rank: "3",
    ring: "ring-orange-400/50",
  },
} as const;

function PodiumSlot({
  entry,
  rank,
  t,
}: {
  entry: PriceIsRightLeaderboardEntry | undefined;
  rank: 1 | 2 | 3;
  t: ReturnType<typeof useTranslations>;
}) {
  const style = PODIUM_STYLES[rank];
  if (!entry) {
    return (
      <div className="flex flex-1 flex-col items-center justify-end opacity-40">
        <div
          className={`w-full max-w-[7.5rem] rounded-t-xl border border-dashed border-hq-border/60 ${style.bar}`}
        />
        <p className="mt-2 text-xs text-hq-fg-muted">{t("podium.empty")}</p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-end ${
        entry.isViewer ? "drop-shadow-[0_0_12px_rgba(251,191,36,0.45)]" : ""
      }`}
      data-testid={`price-is-right-podium-rank-${rank}`}
    >
      <div
        className={`mb-2 flex h-14 w-14 items-center justify-center rounded-xl bg-hq-surface/90 text-2xl font-bold shadow-lg ring-2 ${style.ring}`}
        aria-hidden
      >
        {style.rank}
      </div>
      <p className="max-w-[8.5rem] truncate text-center text-sm font-semibold text-hq-fg">
        {entry.memberName}
      </p>
      <p className="mt-0.5 text-center text-sm font-semibold text-amber-200">
        {t("podium.rankScore", {
          rank: entry.rank,
          score: formatPriceIsRightVsScore(entry.priorDayVsScore),
        })}
      </p>
      <div
        className={`mt-3 w-full max-w-[7.5rem] rounded-t-xl border ${style.bar}`}
      />
    </div>
  );
}

export function PriceIsRightPodiumLeaderboard({ trainDate }: Props) {
  const t = useTranslations("trains.priceIsRight.leaderboard");
  const [payload, setPayload] = useState<LeaderboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/trains/price-is-right/leaderboard?date=${encodeURIComponent(trainDate)}`,
        );
        const body = (await res.json()) as LeaderboardPayload & {
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setError(body.error ?? t("loadFailed"));
            setPayload(null);
          }
          return;
        }
        if (!cancelled) setPayload(body);
      } catch {
        if (!cancelled) {
          setError(t("loadFailed"));
          setPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, trainDate]);

  if (loading) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/40 to-hq-surface p-5"
        data-testid="price-is-right-podium"
      >
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (error || !payload) return null;

  const podiumByRank = new Map(
    payload.podium.map((entry) => [entry.rank, entry] as const),
  );
  const displayRanks = [2, 1, 3] as const;
  const orderedSlots = displayRanks.map((rank) => ({
    rank,
    entry: podiumByRank.get(rank),
  }));

  return (
    <section
      className="overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/50 via-[#0a1628] to-hq-surface p-5 shadow-[inset_0_1px_0_rgba(34,211,238,0.15)]"
      data-testid="price-is-right-podium"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-cyan-100">{t("title")}</h3>
        <p className="text-sm text-hq-fg-muted">
          {t("subtitle", { day: formatScoreDay(payload.scoreDate) })}
        </p>
      </div>

      <div
        className="relative mt-6 flex items-end justify-center gap-2 px-2 pb-2 sm:gap-4"
        aria-label={t("podiumAria")}
      >
        <div
          className="pointer-events-none absolute inset-x-4 bottom-8 h-24 rounded-full bg-cyan-400/10 blur-3xl"
          aria-hidden
        />
        {orderedSlots.map(({ rank, entry }) => (
          <PodiumSlot key={rank} entry={entry} rank={rank} t={t} />
        ))}
      </div>

      {payload.entries.length > 3 ? (
        <ol className="mt-6 space-y-1 border-t border-cyan-500/20 pt-4 text-sm">
          {payload.entries.slice(3, 8).map((entry) => (
            <li
              key={entry.memberId}
              className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 ${
                entry.isViewer ? "bg-amber-500/10" : ""
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-hq-fg">
                {entry.memberName}
              </span>
              <span className="shrink-0 text-amber-200/90">
                {t("podium.rankScore", {
                  rank: entry.rank,
                  score: formatPriceIsRightVsScore(entry.priorDayVsScore),
                })}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
