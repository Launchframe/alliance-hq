"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { PriceIsRightTicketDistributionChart } from "@/components/trains/PriceIsRightTicketDistributionChart";
import { Link } from "@/i18n/navigation";
import {
  boardToChartPoints,
  formatPriceIsRightVsScore,
  normalizePriceIsRightTicketSettings,
  type PriceIsRightTicketBoardEntry,
} from "@/lib/trains/train-price-is-right-tickets.shared";

type OddsMode = "weighted" | "uniform" | "heavy_hitter";

type TicketBoardPayload = {
  mode?: OddsMode;
  trainDate: string;
  scoreDate: string;
  settings: {
    cliffPoints: number | null;
    effectiveCliffPoints?: number;
    hardCutoffEnabled: boolean;
  };
  viewer: {
    memberId: string;
    ticketCount: number;
    priorDayVsScore: number | null;
    winProbability: number;
    missedFloor?: boolean;
    aboveCliff?: boolean;
  } | null;
  board: PriceIsRightTicketBoardEntry[];
  missedFloor: Array<{
    memberId: string;
    memberName: string;
    priorDayVsScore: number;
    isViewer?: boolean;
  }>;
  aboveCliff?: Array<{
    memberId: string;
    memberName: string;
    priorDayVsScore: number;
    isViewer?: boolean;
  }>;
};

type Props = {
  trainDate: string;
  /** VS score upload deep-link when the odds board is empty. */
  uploadHref?: string;
};

const COLLAPSED_VISIBLE = 7;

function formatProbability(value: number): string {
  if (value >= 0.01) return `${(value * 100).toFixed(1)}%`;
  if (value > 0) return `${(value * 100).toFixed(2)}%`;
  return "0%";
}

export function PriceIsRightTicketsPanel({
  trainDate,
  uploadHref = "/tools/video-upload?scoreTarget=vs-performance",
}: Props) {
  const t = useTranslations("trains.priceIsRight");
  const [payload, setPayload] = useState<TicketBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [t, trainDate, reloadKey]);

  const mode: OddsMode = payload?.mode ?? "weighted";
  const isWeighted = mode === "weighted";

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

  if (error || !payload) {
    return (
      <section
        className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5"
        data-testid="price-is-right-tickets-panel"
      >
        <p className="text-sm text-hq-fg-muted">{error ?? t("loadFailed")}</p>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="mt-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20"
        >
          {t("retryLoad")}
        </button>
      </section>
    );
  }

  // Weighted mode keeps the ticket hero + chart even with an empty board
  // (common in e2e / no prior-day VS). Equal-chance modes use a dedicated empty state.
  if (payload.board.length === 0 && !isWeighted) {
    const isHeavyHitter = mode === "heavy_hitter";
    return (
      <section
        className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5"
        data-testid="price-is-right-tickets-panel"
      >
        <h3 className="text-base font-semibold text-cyan-100">
          {isHeavyHitter
            ? t("oddsTitleHeavyHitter")
            : t("oddsTitleUniform")}
        </h3>
        <p className="mt-2 text-sm text-hq-fg-muted">
          {isHeavyHitter
            ? t("oddsEmptyHeavyHitter")
            : t("oddsEmptyUniform")}
        </p>
        <div className="mt-3">
          <Link
            href={isHeavyHitter ? "/settings/trains" : uploadHref}
            className="inline-flex rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-400"
          >
            {isHeavyHitter
              ? t("oddsEmptyHeavyHitterCta")
              : t("oddsEmptyUniformCta")}
          </Link>
        </div>
      </section>
    );
  }

  const ticketSettings = normalizePriceIsRightTicketSettings({
    weightingEnabled: true,
    cliffPoints:
      payload.settings.cliffPoints ??
      payload.settings.effectiveCliffPoints ??
      null,
    hardCutoffEnabled: payload.settings.hardCutoffEnabled,
    maxTicketMemberIds: payload.board
      .filter((row) => row.isTakedownOverride)
      .map((row) => row.memberId),
  });
  const chartPoints = boardToChartPoints(payload.board, ticketSettings);

  return (
    <section
      className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5"
      data-testid="price-is-right-tickets-panel"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-cyan-100">
          {mode === "heavy_hitter"
            ? t("oddsTitleHeavyHitter")
            : mode === "uniform"
              ? t("oddsTitleUniform")
              : t("title")}
        </h3>
        <p className="text-sm text-hq-fg-muted">
          {mode === "heavy_hitter"
            ? t("oddsSubtitleHeavyHitter")
            : mode === "uniform"
              ? t("oddsSubtitleUniform")
              : t("decayHint")}
        </p>
      </div>

      {isWeighted ? (
        <PriceIsRightTicketDistributionChart
          className="mt-5"
          settings={ticketSettings}
          memberPoints={chartPoints}
          data-testid="price-is-right-tickets-chart"
        />
      ) : null}

      <div className="mt-5">
        {expanded ? (
          <div className="overflow-x-auto rounded-lg border border-hq-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-hq-canvas/80 text-xs uppercase tracking-wide text-hq-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("board.member")}</th>
                  {mode !== "heavy_hitter" ? (
                    <th className="px-3 py-2 font-medium">{t("board.vs")}</th>
                  ) : null}
                  {isWeighted ? (
                    <th className="px-3 py-2 font-medium">{t("board.tickets")}</th>
                  ) : null}
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
                      {row.isViewer ? (
                        <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-300">
                          ({t("board.you")})
                        </span>
                      ) : null}
                      {row.isTakedownOverride ? (
                        <span className="ml-2 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                          {t("board.takedownBadge")}
                        </span>
                      ) : null}
                    </td>
                    {mode !== "heavy_hitter" ? (
                      <td className="px-3 py-2 text-hq-fg-muted">
                        {formatPriceIsRightVsScore(row.priorDayVsScore)}
                      </td>
                    ) : null}
                    {isWeighted ? (
                      <td className="px-3 py-2 text-hq-fg">{row.ticketCount}</td>
                    ) : null}
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
                      {row.isViewer ? (
                        <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-300">
                          ({t("board.you")})
                        </span>
                      ) : null}
                      {row.isTakedownOverride ? (
                        <span className="ml-2 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                          {t("board.takedownBadge")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-hq-fg-muted">
                      {mode === "heavy_hitter"
                        ? t("board.chanceOnlyMeta", {
                            probability: formatProbability(row.winProbability),
                          })
                        : t("board.rowMeta", {
                            score: formatPriceIsRightVsScore(row.priorDayVsScore),
                            probability: formatProbability(row.winProbability),
                          })}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-cyan-800 dark:text-cyan-200">
                    {isWeighted
                      ? row.ticketCount
                      : formatProbability(row.winProbability)}
                  </p>
                </li>
              ))}
            </ul>
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

      {(payload.missedFloor.length > 0 || (payload.aboveCliff?.length ?? 0) > 0) ? (
        <div className="mt-6 border-t border-cyan-500/20 pt-5">
          {payload.missedFloor.length > 0 ? (
          <>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-hq-fg">
              {mode === "uniform"
                ? t("missedFloor.titleUniform")
                : t("missedFloor.title")}
            </h4>
            <p className="text-xs text-hq-fg-muted">
              {mode === "uniform"
                ? t("missedFloor.subtitleUniform")
                : t("missedFloor.subtitle")}
            </p>
          </div>
          <div
            className="mt-3 overflow-x-auto rounded-lg border border-hq-border"
            data-testid="price-is-right-missed-floor"
          >
            <table className="min-w-full text-left text-sm">
              <thead className="bg-hq-canvas/80 text-xs uppercase tracking-wide text-hq-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    {t("missedFloor.member")}
                  </th>
                  <th className="px-3 py-2 font-medium">{t("missedFloor.vs")}</th>
                </tr>
              </thead>
              <tbody>
                {payload.missedFloor.map((row) => (
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
                ))}
              </tbody>
            </table>
          </div>
          </>
          ) : null}
          {(payload.aboveCliff?.length ?? 0) > 0 ? (
            <>
              <div className={`flex flex-col gap-1 ${payload.missedFloor.length > 0 ? "mt-6" : ""}`}>
                <h4 className="text-sm font-semibold text-hq-fg">
                  {t("aboveCliff.title")}
                </h4>
                <p className="text-xs text-hq-fg-muted">
                  {t("aboveCliff.subtitle")}
                </p>
              </div>
              <div
                className="mt-3 overflow-x-auto rounded-lg border border-hq-border"
                data-testid="price-is-right-above-cliff"
              >
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-hq-canvas/80 text-xs uppercase tracking-wide text-hq-fg-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        {t("missedFloor.member")}
                      </th>
                      <th className="px-3 py-2 font-medium">{t("missedFloor.vs")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.aboveCliff!.map((row) => (
                      <tr
                        key={row.memberId}
                        className={`border-t border-hq-border/60 ${
                          row.isViewer ? "bg-amber-500/10" : ""
                        }`}
                      >
                        <td className="px-3 py-2 font-medium text-hq-fg">
                          {row.memberName}
                          {row.isViewer ? (
                            <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-300">
                              ({t("board.you")})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-hq-fg-muted">
                          {formatPriceIsRightVsScore(row.priorDayVsScore)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
