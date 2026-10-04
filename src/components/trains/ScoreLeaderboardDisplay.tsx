import type { ReactNode } from "react";

export type ScoreLeaderboardDisplayEntry = {
  rank: number;
  memberId: string;
  memberName: string;
  label: string;
  sublabel?: string;
  isViewer?: boolean;
};

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
  emptyLabel,
  rankVisible,
}: {
  entry: ScoreLeaderboardDisplayEntry | undefined;
  rank: 1 | 2 | 3;
  emptyLabel: string;
  rankVisible?: boolean;
}) {
  const style = PODIUM_STYLES[rank];
  if (!entry) {
    return (
      <div className="flex flex-1 flex-col items-center justify-end opacity-40">
        <div
          className={`w-full max-w-[7.5rem] rounded-t-xl border-dashed border-hq-border/60 ${style.bar}`}
        />
        <p className="mt-2 text-xs text-hq-fg-muted">{emptyLabel}</p>
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
        aria-hidden={!rankVisible}
      >
        {style.rank}
      </div>
      <p className="max-w-[8.5rem] truncate text-center text-sm font-semibold text-hq-fg">
        {entry.memberName}
      </p>
      <p className="mt-0.5 text-center text-sm font-semibold text-hq-accent">
        {entry.label}
      </p>
      {entry.sublabel ? (
        <p className="mt-0.5 text-center text-xs text-hq-fg-muted">
          {entry.sublabel}
        </p>
      ) : null}
      <div className={`mt-3 w-full max-w-[7.5rem] rounded-t-xl ${style.bar}`} />
    </div>
  );
}

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  podium: ReadonlyArray<ScoreLeaderboardDisplayEntry | undefined>;
  remaining: readonly ScoreLeaderboardDisplayEntry[];
  podiumAria: string;
  listAria?: string;
  emptySlotLabel: string;
  testId?: string;
  headerAction?: ReactNode;
  notices?: ReactNode;
  showRanks?: boolean;
  listStart?: number;
};

export function ScoreLeaderboardDisplay({
  title,
  subtitle,
  podium,
  remaining,
  podiumAria,
  listAria,
  emptySlotLabel,
  testId = "score-leaderboard-podium",
  headerAction,
  notices,
  showRanks = false,
  listStart,
}: Props) {
  const displayRanks = [2, 1, 3] as const;
  const orderedSlots = displayRanks.map((rank) => ({
    rank,
    entry: podium[rank - 1],
  }));

  return (
    <section
      className="overflow-hidden rounded-xl border border-hq-accent/30 bg-gradient-to-b from-hq-accent/10 via-hq-surface to-hq-surface p-5"
      data-testid={testId}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-base font-semibold text-hq-fg">{title}</h3>
          {subtitle != null ? (
            <p className="text-sm text-hq-fg-muted">{subtitle}</p>
          ) : null}
        </div>
        {headerAction}
      </div>
      {notices}

      <div
        className="relative mt-6 flex items-end justify-center gap-2 px-2 pb-2 sm:gap-4"
        aria-label={podiumAria}
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
            emptyLabel={emptySlotLabel}
            rankVisible={showRanks}
          />
        ))}
      </div>

      {remaining.length > 0 ? (
        <ol
          className="mt-6 space-y-1 border-t border-hq-border pt-4 text-sm"
          aria-label={listAria}
          start={listStart}
        >
          {remaining.map((entry) => (
            <li
              key={entry.memberId}
              value={showRanks ? entry.rank : undefined}
              className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 ${
                entry.isViewer ? "bg-amber-100 dark:bg-amber-500/10" : ""
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-hq-fg">
                {entry.memberName}
              </span>
              <span className="shrink-0 text-right font-semibold text-hq-accent">
                {entry.label}
                {entry.sublabel ? (
                  <span className="ml-2 text-xs font-normal text-hq-fg-muted">
                    {entry.sublabel}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
