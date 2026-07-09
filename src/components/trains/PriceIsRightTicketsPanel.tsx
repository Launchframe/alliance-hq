"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { PriceIsRightTicketDistributionChart } from "@/components/trains/PriceIsRightTicketDistributionChart";
import {
  boardToChartPoints,
  formatPriceIsRightVsScore,
  type PriceIsRightTicketBoardEntry,
} from "@/lib/trains/train-price-is-right-tickets.shared";

type TicketBoardPayload = {
  trainDate: string;
  scoreDate: string;
  settings: {
    cliffPoints: number | null;
    hardCutoffEnabled: boolean;
  };
  viewer: {
    memberId: string;
    ticketCount: number;
    priorDayVsScore: number | null;
    winProbability: number;
  } | null;
  board: PriceIsRightTicketBoardEntry[];
};

type Props = {
  trainDate: string;
};

const COLLAPSED_VISIBLE = 7;

function formatDayOfWeek(scoreDate: string): string {
  const date = new Date(`${scoreDate}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

function formatProbability(value: number): string {
  if (value >= 0.01) return `${(value * 100).toFixed(1)}%`;
  if (value > 0) return `${(value * 100).toFixed(2)}%`;
  return "0%";
}

export function PriceIsRightTicketsPanel({ trainDate }: Props) {
  const t = useTranslations("trains.priceIsRight");
  const [payload, setPayload] = useState<TicketBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/trains/price-is-right/tickets?date=${encodeURIComponent(trainDate)}`,
        );
        const body = (await res.json()) as TicketBoardPayload & { error?: string };
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

  const collapsedRows = useMemo(() => {
    if (!payload) return [];
    const board = payload.board;
    if (board.length <= COLLAPSED_VISIBLE) return board;

    const viewerIndex = board.findIndex((row) => row.isViewer);
    if (viewerIndex < 0) return board.slice(0, COLLAPSED_VISIBLE);

    const half = Math.floor(COLLAPSED_VISIBLE / 2);
    const start = Math.max(
      0,
      Math.min(viewerIndex - half, board.length - COLLAPSED_VISIBLE),
    );
    return board.slice(start, start + COLLAPSED_VISIBLE);
  }, [payload]);

  if (loading) {
    return (
      <section
        className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5"
        data-testid="price-is-right-tickets-panel"
      >
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      </section>
    );
  }

  if (error || !payload) return null;

  const viewerTickets = payload.viewer?.ticketCount ?? 0;
  const viewerScore = payload.viewer?.priorDayVsScore;
  const chartPoints = boardToChartPoints(payload.board);

  return (
    <section
      className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5"
      data-testid="price-is-right-tickets-panel"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-cyan-100">{t("title")}</h3>
        <p className="text-sm text-hq-fg-muted">{t("decayHint")}</p>
      </div>

      <div
        className="mt-4 rounded-lg border border-hq-border bg-hq-surface/80 px-4 py-3"
        data-testid="price-is-right-tickets-hero"
      >
        <p className="text-lg font-semibold text-hq-fg">
          {t("hero", {
            count: viewerTickets,
            dayOfWeek: formatDayOfWeek(payload.scoreDate),
            score:
              viewerScore != null
                ? formatPriceIsRightVsScore(viewerScore)
                : t("noScore"),
          })}
        </p>
      </div>

      <PriceIsRightTicketDistributionChart
        className="mt-5"
        settings={{
          weightingEnabled: true,
          cliffPoints: payload.settings.cliffPoints,
          hardCutoffEnabled: payload.settings.hardCutoffEnabled,
          maxTicketMemberIds: payload.board
            .filter((row) => row.isTakedownOverride)
            .map((row) => row.memberId),
        }}
        memberPoints={chartPoints}
        data-testid="price-is-right-tickets-chart"
      />

      <div className="mt-5">
        {expanded ? (
          <div className="overflow-x-auto rounded-lg border border-hq-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-hq-canvas/80 text-xs uppercase tracking-wide text-hq-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("board.member")}</th>
                  <th className="px-3 py-2 font-medium">{t("board.vs")}</th>
                  <th className="px-3 py-2 font-medium">{t("board.tickets")}</th>
                  <th className="px-3 py-2 font-medium">{t("board.chance")}</th>
                </tr>
              </thead>
              <tbody>
                {payload.board.map((row) => (
                  <tr
                    key={row.memberId}
                    className={`border-t border-hq-border/60 ${
                      row.isViewer ? "bg-amber-500/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-hq-fg">
                      {row.memberName}
                      {row.isTakedownOverride ? (
                        <span className="ml-2 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                          {t("board.takedownBadge")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-hq-fg-muted">
                      {formatPriceIsRightVsScore(row.priorDayVsScore)}
                    </td>
                    <td className="px-3 py-2 text-hq-fg">{row.ticketCount}</td>
                    <td className="px-3 py-2 text-hq-fg-muted">
                      {formatProbability(row.winProbability)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg border border-hq-border">
            <ul className="divide-y divide-hq-border/60">
              {collapsedRows.map((row) => (
                <li
                  key={row.memberId}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                    row.isViewer ? "bg-amber-500/10" : "bg-hq-surface/60"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-hq-fg">
                      {row.memberName}
                      {row.isTakedownOverride ? (
                        <span className="ml-2 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                          {t("board.takedownBadge")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-hq-fg-muted">
                      {t("board.rowMeta", {
                        score: formatPriceIsRightVsScore(row.priorDayVsScore),
                        probability: formatProbability(row.winProbability),
                      })}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-cyan-200">
                    {row.ticketCount}
                  </p>
                </li>
              ))}
            </ul>
            {payload.board.length > COLLAPSED_VISIBLE ? (
              <>
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-20"
                  style={{
                    background:
                      "linear-gradient(to bottom, #0d1117 0%, rgba(13,17,23,0.94) 20%, rgba(13,17,23,0.6) 48%, transparent 100%)",
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-20"
                  style={{
                    background:
                      "linear-gradient(to top, #0d1117 0%, rgba(13,17,23,0.94) 20%, rgba(13,17,23,0.6) 48%, transparent 100%)",
                  }}
                />
              </>
            ) : null}
          </div>
        )}

        {payload.board.length > COLLAPSED_VISIBLE ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 text-sm font-medium text-cyan-300 hover:text-cyan-200"
            data-testid="price-is-right-tickets-expand"
          >
            {expanded ? t("board.collapse") : t("board.expand")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
