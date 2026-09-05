"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { formatPriceIsRightVsScore } from "@/lib/trains/train-price-is-right-tickets.shared";

export type MemberScoreListRow = {
  memberId: string;
  memberName: string;
  priorDayVsScore: number;
  isViewer?: boolean;
};

type Props = {
  rows: MemberScoreListRow[];
  title: string;
  subtitle: string;
  /** Unique test id root, e.g. price-is-right-missed-floor */
  testId: string;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 8;

export function SearchablePaginatedMemberScoreList({
  rows,
  title,
  subtitle,
  testId,
  pageSize = DEFAULT_PAGE_SIZE,
}: Props) {
  const t = useTranslations("trains.priceIsRight.scoreList");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      row.memberName.toLowerCase().includes(needle),
    );
  }, [query, rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold text-hq-fg">{title}</h4>
        <p className="text-xs text-hq-fg-muted">{subtitle}</p>
      </div>
      <label className="block text-xs text-hq-fg-muted">
        <span className="sr-only">{t("searchLabel")}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder={t("searchPlaceholder")}
          data-testid={`${testId}-search`}
          className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg placeholder:text-hq-fg-muted"
        />
      </label>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-hq-border">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-hq-canvas/95 text-xs uppercase tracking-wide text-hq-fg-muted backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-medium">{t("member")}</th>
              <th className="px-3 py-2 font-medium">{t("vs")}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="px-3 py-4 text-center text-hq-fg-muted"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={row.memberId}
                  className={`border-t border-hq-border/60 ${
                    row.isViewer ? "bg-amber-500/10" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-hq-fg">
                    {row.memberName}
                  </td>
                  <td className="px-3 py-2 text-hq-fg-muted">
                    {formatPriceIsRightVsScore(row.priorDayVsScore)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSize ? (
        <div className="flex items-center justify-between gap-2 text-xs text-hq-fg-muted">
          <span>
            {t("pageStatus", {
              page: safePage + 1,
              pages: pageCount,
              count: filtered.length,
            })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              className="rounded border border-hq-border px-2 py-1 font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-40"
              data-testid={`${testId}-prev`}
            >
              {t("prev")}
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() =>
                setPage((value) => Math.min(pageCount - 1, value + 1))
              }
              className="rounded border border-hq-border px-2 py-1 font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-40"
              data-testid={`${testId}-next`}
            >
              {t("next")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
