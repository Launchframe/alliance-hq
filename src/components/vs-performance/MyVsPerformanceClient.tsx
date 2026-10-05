"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { VsDayBadge } from "./VsDayBadge";
import {
  formatVsScore,
  VS_MEMBER_EXCUSAL_KEYS,
  VS_MEMBER_SIGNAL_KEYS,
  VS_MEMBER_STATUS_KEYS,
  vsMemberPolicyLineKey,
  vsMemberSourceKey,
} from "@/lib/vs-performance/member-performance-view.shared";
import type {
  MyVsPerformanceHistoryPage,
  MyVsPerformanceResponse,
} from "@/lib/vs-performance/my-performance.shared";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;

const emptyData = (commanders: MyVsPerformanceResponse["commanders"]): MyVsPerformanceResponse => ({
  commanders,
  member: null,
  weekStart: null,
  weekEnding: null,
  live: false,
  policy: null,
  source: null,
  week: null,
  history: { weeks: [], nextBefore: null },
  officerHref: null,
});

export function MyVsPerformanceClient({ initial }: { initial: MyVsPerformanceResponse }) {
  const t = useTranslations("myVsPerformance");
  const tMembers = useTranslations("vsPerformance.members");
  const tMember = useTranslations("vsPerformance.member");
  const tActions = useTranslations("vsPerformance.actions");
  const tWeekdays = useTranslations("trains.weekdays");
  const locale = useLocale();
  const intl = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const date = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${value}T12:00:00Z`),
      ),
    [locale],
  );

  const [data, setData] = useState<MyVsPerformanceResponse>(initial);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    initial.member?.memberId ?? initial.commanders[0]?.memberId ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"load" | "unavailable" | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const requestSeq = useRef(0);
  const historySeq = useRef(0);

  const loadMember = useCallback(async (memberId: string) => {
    const seq = ++requestSeq.current;
    historySeq.current += 1;
    setLoading(true);
    setError(null);
    setHistoryError(false);
    let failedStatus = 0;
    try {
      const res = await fetch(`/api/my-vs-performance?memberId=${encodeURIComponent(memberId)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        failedStatus = res.status;
        throw new Error(String(res.status));
      }
      const body = (await res.json()) as MyVsPerformanceResponse;
      if (body.member?.memberId !== memberId) throw new Error("stale");
      if (seq !== requestSeq.current) return;
      setData(body);
    } catch {
      if (seq !== requestSeq.current) return;
      if (failedStatus === 401 || failedStatus === 403 || failedStatus === 404) {
        setData(emptyData([]));
        setSelectedMemberId(null);
        setError(failedStatus === 404 ? "unavailable" : "load");
      } else {
        setData((prev) => emptyData(prev.commanders));
        setError("load");
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  const selectMember = useCallback(
    (memberId: string) => {
      setSelectedMemberId(memberId);
      setData((prev) => emptyData(prev.commanders));
      void loadMember(memberId);
    },
    [loadMember],
  );

  const loadOlder = useCallback(async () => {
    const memberId = data.member?.memberId;
    const before = data.history.nextBefore;
    if (!memberId || !before || historyLoading) return;
    const seq = ++historySeq.current;
    setHistoryLoading(true);
    setHistoryError(false);
    let failedStatus = 0;
    try {
      const res = await fetch(
        `/api/my-vs-performance?memberId=${encodeURIComponent(memberId)}&beforeWeek=${encodeURIComponent(before)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        failedStatus = res.status;
        throw new Error(String(res.status));
      }
      const body = (await res.json()) as MyVsPerformanceHistoryPage;
      if (body.memberId !== memberId) throw new Error("stale");
      if (seq !== historySeq.current) return;
      setData((prev) =>
        prev.member?.memberId === memberId
          ? {
              ...prev,
              history: {
                weeks: [...prev.history.weeks, ...body.history.weeks],
                nextBefore: body.history.nextBefore,
              },
            }
          : prev,
      );
    } catch {
      if (seq !== historySeq.current) return;
      if (failedStatus === 401 || failedStatus === 403 || failedStatus === 404) {
        setData(emptyData([]));
        setSelectedMemberId(null);
        setError(failedStatus === 404 ? "unavailable" : "load");
      } else {
        setHistoryError(true);
      }
    } finally {
      if (seq === historySeq.current) setHistoryLoading(false);
    }
  }, [data.member?.memberId, data.history.nextBefore, historyLoading]);

  const week = data.week;
  const policyKey = data.policy ? vsMemberPolicyLineKey(data.policy) : "noPolicy";
  const sourceKey = data.source ? vsMemberSourceKey(data.source) : null;
  const sequence = week?.sequence ?? null;
  const promotionProgress = sequence?.promotion.progress ?? null;
  const demotionProgress = sequence?.demotion.progress ?? null;

  return (
    <div className="space-y-6" data-testid="my-vs-performance">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>

      {data.commanders.length === 0 && error === null ? (
        <div className="space-y-3 rounded border border-hq-border p-4" data-testid="my-vs-empty">
          <p className="text-sm">{t("noCommander")}</p>
          <Link
            href="/onboard?next=%2Fmy-vs-performance"
            className="inline-block rounded border border-hq-border bg-hq-accent px-3 py-2 text-sm text-hq-accent-fg"
          >
            {t("linkCommander")}
          </Link>
        </div>
      ) : null}

      {data.commanders.length > 1 ? (
        <label className="block text-sm">
          {t("selectCommander")}
          <select
            className="mt-1 block rounded border border-hq-border bg-hq-bg px-2 py-1"
            data-testid="my-vs-commander-select"
            value={selectedMemberId ?? ""}
            onChange={(event) => selectMember(event.target.value)}
          >
            {data.commanders.map((commander) => (
              <option key={commander.memberId} value={commander.memberId}>
                {commander.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-sm text-hq-danger" data-testid="my-vs-error">
          {error === "unavailable" ? t("unavailable") : t("loadFailed")}
          {error === "load" && selectedMemberId !== null ? (
            <>
              {" "}
              <button
                type="button"
                className="underline"
                onClick={() => void loadMember(selectedMemberId)}
                data-testid="my-vs-retry"
              >
                {tActions("retry")}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-hq-fg-muted">
          {tActions("loading")}
        </p>
      ) : null}

      {data.member && week ? (
        <section className="space-y-3" data-testid="my-vs-week">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{t("currentProgress")}</h2>
            {data.weekEnding ? (
              <p className="text-sm text-hq-fg-muted">
                {tMember("weekEnding", { date: date(data.weekEnding) })}
                {data.live ? ` · ${tMembers("inProgress")}` : ` · ${tMembers("closed")}`}
              </p>
            ) : null}
            <p className="text-sm">
              {tMembers("rank")}:{" "}
              {data.member.currentRank !== null
                ? tMembers("rankLabel", { rank: data.member.currentRank })
                : tMembers("rankUnknown")}
            </p>
            {data.policy && policyKey === "policyLine" ? (
              <p className="text-sm text-hq-fg-muted">
                {tMembers("policyLine", {
                  minimum: intl.format(data.policy.dailyThreshold ?? 0),
                  allowed: intl.format(data.policy.allowedMissedDays ?? 0),
                })}
              </p>
            ) : (
              <p className="text-sm text-hq-fg-muted">
                {policyKey === "policyLegacy" ? tMembers("policyLegacy") : tMembers("noPolicy")}
              </p>
            )}
            {sourceKey ? (
              <p className="text-sm text-hq-fg-muted">
                {sourceKey === "sourceChecked" && data.source?.verifiedAt
                  ? tMembers("sourceChecked", {
                      time: new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Etc/GMT+2",
                      }).format(new Date(data.source.verifiedAt)),
                    })
                  : tMembers("sourceStale")}
              </p>
            ) : null}
          </div>

          <div className="space-y-1 text-sm">
            {week.counts.required > 0 ? (
              <p data-testid="my-vs-progress">
                {t("progressLive", {
                  met: intl.format(week.counts.met),
                  required: intl.format(week.counts.required),
                })}
              </p>
            ) : (
              <p data-testid="my-vs-progress">{t("progressNone")}</p>
            )}
            {week.counts.unknown > 0 ? (
              <p className="text-hq-fg-muted">{t("progressUnknown")}</p>
            ) : null}
            {week.status !== "in_progress" ? (
              <p>
                {tMembers("status")}: {tMembers(VS_MEMBER_STATUS_KEYS[week.status])}
              </p>
            ) : null}
            {VS_MEMBER_EXCUSAL_KEYS[week.excusal] ? (
              <p>{tMembers(VS_MEMBER_EXCUSAL_KEYS[week.excusal]!)}</p>
            ) : null}
            {week.signal.kind === "promotion" && week.signal.targetRank !== null ? (
              <p>{tMembers("promotionTarget", { rank: tMembers("rankLabel", { rank: week.signal.targetRank }) })}</p>
            ) : week.signal.kind !== "none" ? (
              <p>{tMembers(VS_MEMBER_SIGNAL_KEYS[week.signal.kind])}</p>
            ) : null}
            {promotionProgress !== null && promotionProgress > 0 ? (
              <p>
                {t(sequence!.promotion.unit === "days" ? "promotionDays" : "promotionWeeks", {
                  count: intl.format(promotionProgress),
                  required: intl.format(sequence!.promotion.length),
                })}
              </p>
            ) : null}
            {demotionProgress !== null && demotionProgress > 0 ? (
              <p>
                {tMember(sequence!.demotion.unit === "days" ? "demotionDays" : "demotionWeeks", {
                  count: intl.format(demotionProgress),
                  required: intl.format(sequence!.demotion.length),
                })}
              </p>
            ) : null}
            {(week.signal.kind === "promotion" || (promotionProgress !== null && promotionProgress > 0)) ? (
              <p className="text-hq-fg-muted">{t("advisoryHint")}</p>
            ) : null}
            {week.corrected ? <p>{t("scoreCorrected")}</p> : null}
          </div>

          <div className="flex items-start gap-3" data-testid="my-vs-days">
            {week.days.map((day, index) => (
              <div key={day.date} className="flex flex-col items-center gap-0.5">
                <span className="text-xs text-hq-fg-muted">{tWeekdays(DAY_KEYS[index])}</span>
                <VsDayBadge day={day} dayName={tWeekdays(DAY_KEYS[index])} />
              </div>
            ))}
          </div>

          {week.reportedTotal !== null ? (
            <p className="text-sm">
              {tMembers("reportedTotal")}: {formatVsScore(week.reportedTotal, locale)}
            </p>
          ) : null}
          {week.dailySubtotal !== null ? (
            <p className="text-sm">
              {tMember("dailySubtotal")}: {formatVsScore(week.dailySubtotal, locale)}
              {week.knownDays < 6
                ? ` · ${tMembers("partialTotal", { count: intl.format(week.knownDays) })}`
                : ""}
            </p>
          ) : null}

          <p className="text-sm text-hq-fg-muted">{t("readOnly")}</p>
          {data.officerHref ? (
            <Link
              href={data.officerHref}
              className="inline-block rounded border border-hq-border px-3 py-2 text-sm"
              data-testid="my-vs-officer-link"
            >
              {t("officerView")}
            </Link>
          ) : null}
        </section>
      ) : data.member && !loading && !week ? (
        <p className="text-sm text-hq-fg-muted" data-testid="my-vs-week-empty">
          {t("weekEmpty")}
        </p>
      ) : null}

      {data.member ? (
        <section className="space-y-2" data-testid="my-vs-journey">
          <h2 className="text-lg font-medium">{t("journey")}</h2>
          {data.history.weeks.length === 0 ? (
            <p className="text-sm text-hq-fg-muted">{t("journeyEmpty")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.history.weeks.map((entry) => (
                <li key={entry.weekEnding} className="rounded border border-hq-border p-2">
                  <p>
                    {tMember("weekEnding", { date: date(entry.weekEnding) })} ·{" "}
                    {tMembers(VS_MEMBER_STATUS_KEYS[entry.status])}
                    {entry.score !== null ? ` · ${formatVsScore(entry.score, locale)}` : ""}
                  </p>
                  {entry.excused ? <p>{tMembers("excused")}</p> : null}
                  {entry.corrected ? <p>{t("scoreCorrected")}</p> : null}
                  {entry.settled ? (
                    <p>
                      {entry.settled.kind === "remove"
                        ? t("membershipEnded")
                        : t("rankChangeRecorded", {
                            rank:
                              entry.settled.targetRank !== null
                                ? tMembers("rankLabel", { rank: entry.settled.targetRank })
                                : tMembers("rankUnknown"),
                          })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {historyError ? (
            <p role="alert" className="text-sm text-hq-danger">
              {t("historyFailed")}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => void loadOlder()}
                data-testid="my-vs-history-retry"
              >
                {tActions("retry")}
              </button>
            </p>
          ) : null}
          {data.history.nextBefore ? (
            <button
              type="button"
              className="rounded border border-hq-border px-3 py-2 text-sm disabled:opacity-50"
              disabled={historyLoading}
              onClick={() => void loadOlder()}
              data-testid="my-vs-older-weeks"
            >
              {historyLoading ? tActions("loading") : tMember("olderWeeks")}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
