"use client";

import {
  Check,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleSlash,
  Clock,
  Hourglass,
  Minus,
  TriangleAlert,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  formatVsScore,
  VS_MEMBER_EXCUSAL_KEYS,
  VS_MEMBER_SIGNAL_KEYS,
  VS_MEMBER_STATUS_KEYS,
  vsMemberDayMessage,
  vsMemberShowCoverage,
  vsMemberTotalDisplay,
  type VsMembersViewQuery,
} from "@/lib/vs-performance/member-performance-view.shared";
import type { VsMemberDay, VsMemberRow } from "@/lib/vs-performance/member-performance.shared";

type SortableKey = "name" | "rank" | "day0" | "day1" | "day2" | "day3" | "day4" | "day5" | "total";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;

type Props = {
  rows: VsMemberRow[];
  sort: VsMembersViewQuery["sort"];
  direction: "asc" | "desc";
  onSort: (sort: SortableKey) => void;
  emptyLabel: string;
};

function DayCell({ day, dayName }: { day: VsMemberDay; dayName: string }) {
  const t = useTranslations("vsPerformance.members");
  const locale = useLocale();
  const { key, args } = vsMemberDayMessage(day);
  const stateLabel = t(key, args.score !== undefined ? { score: formatVsScore(args.score, locale) } : {});
  const icons: Record<VsMemberDay["state"], typeof Check> = {
    open: CircleDashed,
    in_progress: Clock,
    met: Check,
    missed: X,
    excused: CircleSlash,
    pending_excusal: Hourglass,
    missing: Minus,
    conflict: TriangleAlert,
    unverified: CircleHelp,
    recorded: CircleDot,
  };
  const Icon = icons[day.state];
  const accessibleLabel = `${t("dayCell", { day: dayName, state: stateLabel })}${
    day.source === "derived" ? ` — ${t("derived")}` : ""
  }`;
  return (
    <td className="whitespace-nowrap px-2 py-2 text-center text-xs">
      <span className="inline-flex flex-col items-center" title={stateLabel}>
        <span aria-hidden className="inline-flex flex-col items-center">
          {day.score !== null ? (
            <span className="tabular-nums text-hq-fg">{formatVsScore(day.score, locale)}</span>
          ) : (
            <span className="text-hq-fg-muted">—</span>
          )}
          <Icon className="h-3 w-3 text-hq-fg-muted" strokeWidth={2.5} />
        </span>
        <span className="sr-only">{accessibleLabel}</span>
      </span>
    </td>
  );
}

export function VsMemberTable({ rows, sort, direction, onSort, emptyLabel }: Props) {
  const t = useTranslations("vsPerformance.members");
  const tWeekdays = useTranslations("trains.weekdays");
  const tCompliance = useTranslations("vsCompliance");
  const locale = useLocale();

  const sortable = new Set<SortableKey>(["name", "rank", "day0", "day1", "day2", "day3", "day4", "day5", "total"]);
  const ariaSort = (key: SortableKey) =>
    sort === key ? (direction === "asc" ? "ascending" : "descending") : undefined;

  const headerCell = (key: SortableKey | null, label: string, extraClass = "") => {
    const sortKey = key && sortable.has(key) ? key : null;
    return (
      <th
        scope="col"
        aria-sort={sortKey ? ariaSort(sortKey) : undefined}
        className={`whitespace-nowrap px-2 py-2 text-xs font-medium text-hq-fg-muted ${extraClass}`}
      >
        {sortKey ? (
          <button
            type="button"
            onClick={() => onSort(sortKey)}
            className="inline-flex items-center gap-1 rounded hover:text-hq-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-hq-accent"
          >
            {label}
            {sort === sortKey ? (
              <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>
            ) : null}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  const signalLabel = (row: VsMemberRow): string => {
    const kind = row.signal.kind;
    if (kind === "leadership_review") return tCompliance("leadershipReview");
    if (kind === "promotion" && row.signal.targetRank !== null)
      return t("promotionTarget", { rank: t("rankLabel", { rank: row.signal.targetRank }) });
    return t(VS_MEMBER_SIGNAL_KEYS[kind]);
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-hq-border" data-testid="vs-members-table-wrap">
      <table className="min-w-full divide-y divide-hq-border text-sm" data-testid="vs-members-table">
        <thead className="bg-hq-surface-muted/50">
          <tr>
            {headerCell("name", t("member"), "text-left sticky left-0 z-10 bg-hq-surface-muted")}
            {headerCell("rank", t("rank"), "text-center")}
            <th scope="col" className="whitespace-nowrap px-2 py-2 text-xs font-medium text-hq-fg-muted text-left">{t("status")}</th>
            <th scope="col" className="whitespace-nowrap px-2 py-2 text-xs font-medium text-hq-fg-muted text-left">{t("signal")}</th>
            {DAY_KEYS.map((day, index) => headerCell(`day${index}` as SortableKey, tWeekdays(day), "text-center"))}
            {headerCell("total", t("total"), "text-right")}
            <th scope="col" className="whitespace-nowrap px-2 py-2 text-xs font-medium text-hq-fg-muted text-center">{t("daysMet")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hq-border bg-hq-surface">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={12} className="px-4 py-8 text-center text-sm text-hq-fg-muted">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const total = vsMemberTotalDisplay(row);
              return (
                <tr key={row.memberId} className="hover:bg-hq-surface-muted/40">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-hq-surface px-3 py-2 text-left font-medium text-hq-fg">
                    {row.name}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-center text-xs text-hq-fg-muted">
                    {row.currentRank !== null ? t("rankLabel", { rank: row.currentRank }) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-left">
                    <span className="text-xs text-hq-fg">{t(VS_MEMBER_STATUS_KEYS[row.status])}</span>
                    <span className="ml-1 inline-flex flex-wrap gap-1">
                      {row.excusal !== "none" && VS_MEMBER_EXCUSAL_KEYS[row.excusal] ? (
                        <span className="rounded bg-hq-surface-muted px-1 py-0.5 text-[10px] text-hq-fg-muted">
                          {t(VS_MEMBER_EXCUSAL_KEYS[row.excusal]!)}
                        </span>
                      ) : null}
                      {row.actionNeeded ? (
                        <span className="rounded bg-hq-danger/15 px-1 py-0.5 text-[10px] text-hq-danger">
                          {t("actionNeeded")}
                        </span>
                      ) : null}
                      {row.rosterStatus === "former" ? (
                        <span className="rounded bg-hq-surface-muted px-1 py-0.5 text-[10px] text-hq-fg-muted">
                          {t("formerMember")}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-left text-xs text-hq-fg-muted">
                    {signalLabel(row)}
                  </td>
                  {row.days.map((day, index) => (
                    <DayCell key={day.date} day={day} dayName={tWeekdays(DAY_KEYS[index])} />
                  ))}
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {total.kind === "none" ? (
                      <span className="text-hq-fg-muted">—</span>
                    ) : (
                      <span className="tabular-nums text-hq-fg">{formatVsScore(total.value, locale)}</span>
                    )}
                    {total.kind === "reported" ? (
                      <span className="block text-[10px] text-hq-fg-muted">{t("reportedTotal")}</span>
                    ) : null}
                    {total.kind === "partial" ? (
                      <span className="block text-[10px] text-hq-fg-muted">
                        {t("partialTotal", { count: total.count })}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-center text-xs text-hq-fg-muted">
                    {vsMemberShowCoverage(row.counts)
                      ? t("coverage", { met: row.counts.met, required: row.counts.required })
                      : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
