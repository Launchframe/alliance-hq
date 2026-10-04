"use client";

import { useLocale, useTranslations } from "next-intl";

import { ScoreLeaderboardDisplay } from "@/components/trains/ScoreLeaderboardDisplay";
import type { WeeklyPifBoard } from "@/lib/vs-performance/weekly-pif.shared";

type Props = {
  board: WeeklyPifBoard | null;
  error: string | null;
};

function formatScore(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value);
}

export function WeeklyPriceIsFreightPodium({ board, error }: Props) {
  const t = useTranslations("vsPerformance");
  const tRank = useTranslations("trains.scoreLeaderboard.podium");
  const locale = useLocale();

  if (error) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-border bg-hq-surface p-5"
        data-testid="weekly-pif-podium"
      >
        <h3 className="text-base font-semibold text-hq-fg">
          {t("podium.title")}
        </h3>
        <p className="mt-1 text-sm text-hq-danger" role="alert">
          {t("errors.load")}
        </p>
      </section>
    );
  }

  if (board == null) return null;

  if (board.scheduledDates.length === 0) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-hq-border bg-hq-surface p-5"
        data-testid="weekly-pif-podium"
      >
        <h3 className="text-base font-semibold text-hq-fg">
          {t("podium.title")}
        </h3>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("podium.noPif")}</p>
      </section>
    );
  }

  const noData = board.countedDates.length === 0;
  const noQualifiers = !noData && board.entries.length === 0;

  const toDisplayEntry = (entry: WeeklyPifBoard["entries"][number]) => ({
    rank: entry.rank,
    memberId: entry.memberId,
    memberName: entry.memberName,
    label: tRank("rankScore", {
      rank: entry.rank,
      score: t("podium.averageScore", {
        score: formatScore(entry.averageScore, locale),
      }),
    }),
    sublabel: t("podium.averageOver", {
      points: formatScore(entry.averageExcess, locale),
    }),
    isViewer: entry.isViewer,
  });

  const notices = (
    <div className="mt-3 space-y-1">
      <p className="text-xs text-hq-fg-muted">
        {t("podium.coverage", {
          count: board.countedDates.length,
          total: board.scheduledDates.length,
        })}
        {" · "}
        {t("podium.qualification")}
      </p>
      {board.provisional && !noData ? (
        <p className="text-xs font-medium text-[#b08800] dark:text-[#e3b341]">
          {t("podium.provisional")}
        </p>
      ) : null}
    </div>
  );

  return (
    <div data-testid="weekly-pif-podium">
      <ScoreLeaderboardDisplay
        title={t("podium.title")}
        subtitle={t("podium.subtitle")}
        podium={[1, 2, 3].map((rank) => {
          const entry = board.podium.find((e) => e.rank === rank);
          return entry ? toDisplayEntry(entry) : undefined;
        })}
        remaining={board.remaining.map(toDisplayEntry)}
        podiumAria={t("podium.aria")}
        listAria={t("podium.listAria")}
        emptySlotLabel={t("results.pending")}
        notices={notices}
        showRanks
        listStart={4}
      />
      {noData ? (
        <p className="mt-2 px-5 text-sm text-hq-fg-muted" role="status">
          {t("podium.noData")}
        </p>
      ) : null}
      {noQualifiers ? (
        <p className="mt-2 px-5 text-sm text-hq-fg-muted" role="status">
          {t("podium.noQualifiers")}
        </p>
      ) : null}
    </div>
  );
}
