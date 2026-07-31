"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { formatTrainPointCount } from "@/lib/trains/train-conductor-minimums.shared";
import {
  SCORE_LEADERBOARD_LIST_MAX,
  type ScoreLeaderboardEntry,
  type ScoreLeaderboardKind,
  type ScoreLeaderboardPayload,
} from "@/lib/trains/score-leaderboard-podium.shared";

type Props = {
  trainDate: string;
  kind: ScoreLeaderboardKind;
};

/** Sub-namespace under `trains.scoreLeaderboard` holding this kind's title/subtitle/aria copy. */
function copyKeyForKind(kind: ScoreLeaderboardKind): "tpif" | "vsPush" {
  return kind === "vs_push" ? "vsPush" : "tpif";
}

function formatScoreDay(scoreDate: string, locale: string): string {
  return new Date(`${scoreDate}T12:00:00`).toLocaleDateString(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

const PODIUM_STYLES = {
  1: {
    bar: "h-36 border border-amber-400 bg-gradient-to-t from-amber-500 via-amber-300 to-amber-100 dark:border-amber-300/50 dark:from-amber-600/90 dark:via-amber-400/80 dark:to-amber-200/30",
    ring: "ring-amber-400 dark:ring-amber-300/60",
    rank: "1",
  },
  2: {
    bar: "h-28 border border-slate-400 bg-gradient-to-t from-slate-400 via-slate-200 to-slate-50 dark:border-slate-300/40 dark:from-slate-500/90 dark:via-slate-300/70 dark:to-slate-100/20",
    ring: "ring-slate-400 dark:ring-slate-300/50",
    rank: "2",
  },
  3: {
    bar: "h-24 border border-orange-400 bg-gradient-to-t from-orange-500 via-orange-300 to-orange-100 dark:border-orange-400/40 dark:from-orange-700/90 dark:via-orange-500/70 dark:to-orange-200/20",
    ring: "ring-orange-400 dark:ring-orange-400/50",
    rank: "3",
  },
} as const;

function PodiumSlot({
  entry,
  rank,
  locale,
  t,
}: {
  entry: ScoreLeaderboardEntry | undefined;
  rank: 1 | 2 | 3;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const style = PODIUM_STYLES[rank];
  if (!entry) {
    return (
      <div className="flex flex-1 flex-col items-center justify-end opacity-40">
        <div
          className={`w-full max-w-[7.5rem] rounded-t-xl border-dashed border-hq-border/60 ${style.bar}`}
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
      data-testid={`score-leaderboard-podium-rank-${rank}`}
    >
      <div
        className={`mb-2 flex h-14 w-14 items-center justify-center rounded-xl bg-hq-surface/90 text-2xl font-bold text-hq-fg shadow-lg ring-2 ${style.ring}`}
        aria-hidden
      >
        {style.rank}
      </div>
      <p className="max-w-[8.5rem] truncate text-center text-sm font-semibold text-hq-fg">
        {entry.memberName}
      </p>
      <p className="mt-0.5 text-center text-sm font-semibold text-hq-accent">
        {t("podium.rankScore", {
          rank: entry.rank,
          score: formatTrainPointCount(entry.score, locale),
        })}
      </p>
      <div className={`mt-3 w-full max-w-[7.5rem] rounded-t-xl ${style.bar}`} />
    </div>
  );
}

export function ScoreLeaderboardPodium({ trainDate, kind }: Props) {
  const t = useTranslations("trains.scoreLeaderboard");
  const locale = useLocale();
  const [payload, setPayload] = useState<ScoreLeaderboardPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/trains/score-leaderboard?date=${encodeURIComponent(trainDate)}&kind=${encodeURIComponent(kind)}`,
        );
        const body = (await res.json()) as ScoreLeaderboardPayload & {
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
  }, [kind, t, trainDate]);

  if (loading) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-accent/30 bg-gradient-to-b from-hq-accent/10 to-hq-surface p-5"
        data-testid="score-leaderboard-podium"
      >
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-accent/30 bg-gradient-to-b from-hq-accent/10 to-hq-surface p-5"
        data-testid="score-leaderboard-podium"
      >
        <p className="text-sm text-hq-danger">{error}</p>
      </section>
    );
  }

  if (!payload) return null;

  if (payload.unavailable) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-border bg-hq-surface p-5"
        data-testid="score-leaderboard-podium"
      >
        <h3 className="text-base font-semibold text-hq-fg">
          {t("donations.unavailableTitle")}
        </h3>
        <p className="mt-1 text-sm text-hq-fg-muted">
          {t("donations.unavailableBody")}
        </p>
      </section>
    );
  }

  const copyKey = copyKeyForKind(kind);
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
      className="overflow-hidden rounded-xl border border-hq-accent/30 bg-gradient-to-b from-hq-accent/10 via-hq-surface to-hq-surface p-5"
      data-testid="score-leaderboard-podium"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-hq-fg">
          {t(`${copyKey}.title`)}
        </h3>
        <p className="text-sm text-hq-fg-muted">
          {t(`${copyKey}.subtitle`, {
            day: payload.scoreDate
              ? formatScoreDay(payload.scoreDate, locale)
              : "",
          })}
        </p>
      </div>

      <div
        className="relative mt-6 flex items-end justify-center gap-2 px-2 pb-2 sm:gap-4"
        aria-label={t(`${copyKey}.podiumAria`)}
      >
        <div
          className="pointer-events-none absolute inset-x-4 bottom-8 h-24 rounded-full bg-hq-accent/10 blur-3xl"
          aria-hidden
        />
        {orderedSlots.map(({ rank, entry }) => (
          <PodiumSlot
            key={rank}
            entry={entry}
            rank={rank}
            locale={locale}
            t={t}
          />
        ))}
      </div>

      {payload.entries.length > 3 ? (
        <ol className="mt-6 space-y-1 border-t border-hq-border pt-4 text-sm">
          {payload.entries
            .slice(3, SCORE_LEADERBOARD_LIST_MAX)
            .map((entry) => (
              <li
                key={entry.memberId}
                className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 ${
                  entry.isViewer ? "bg-amber-100 dark:bg-amber-500/10" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-hq-fg">
                  {entry.memberName}
                </span>
                <span className="shrink-0 font-semibold text-hq-accent">
                  {t("podium.rankScore", {
                    rank: entry.rank,
                    score: formatTrainPointCount(entry.score, locale),
                  })}
                </span>
              </li>
            ))}
        </ol>
      ) : null}
    </section>
  );
}
