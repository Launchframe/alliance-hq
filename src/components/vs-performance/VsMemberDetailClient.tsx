"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { DirtyNavigation } from "@/components/navigation/DirtyNavigation";
import { ConfirmationDialog } from "@/components/vs-compliance/ConfirmationDialog";
import { ComplianceHistoryRecords } from "@/components/vs-compliance/ComplianceHistory";
import {
  isComplianceHistory,
  readComplianceResponse,
  syncLabel,
  type ConfirmationTarget,
} from "@/components/vs-compliance/client.shared";
import type { VsComplianceHistory } from "@/lib/vs-compliance/types.shared";
import {
  formatVsScore,
  VS_MEMBER_EXCUSAL_KEYS,
  VS_MEMBER_STATUS_KEYS,
  vsMemberDetailApiParams,
  vsMemberPolicyLineKey,
  vsMemberSourceKey,
  type VsMemberDetailResponse,
  type VsMemberDetailWeek,
  type VsMemberHistoryPage,
  type VsMemberHistoryWeek,
  type VsMemberRevisionsResponse,
} from "@/lib/vs-performance/member-performance-view.shared";
import { VsDayBadge } from "./VsDayBadge";
import { VsMemberScoreEditor } from "./VsMemberScoreEditor";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
const buttonClass = "rounded border border-hq-border px-3 py-2 text-sm disabled:opacity-50";

type LoadError = "load" | "forbidden" | "notFound";

function SequenceFacts({ week, weekEnding, legacySummary = false }: { week: VsMemberDetailWeek; weekEnding?: string; legacySummary?: boolean }) {
  const t = useTranslations("vsPerformance.member");
  const tMembers = useTranslations("vsPerformance.members");
  const all = useTranslations();
  const locale = useLocale();
  const intl = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${value}T12:00:00Z`),
    );
  const sequence = week.sequence;
  return (
    <div className="space-y-2 text-sm">
      {week.policyVersion !== null ? (
        <p>{t("policyVersion", { version: intl.format(week.policyVersion) })}</p>
      ) : null}
      {legacySummary && week.modelVersion === 1 && weekEnding && week.score !== null && week.threshold !== null ? (
        <p>
          {all("vsCompliance.weekSummary", {
            date: date(weekEnding),
            score: formatVsScore(week.score, locale),
            minimum: intl.format(week.threshold),
          })}
        </p>
      ) : null}
      {week.modelVersion === 2 ? (
        <p>
          {t("dayCounts", {
            met: intl.format(week.counts.met),
            missed: intl.format(week.counts.missed),
            excused: intl.format(week.counts.excused),
            unknown: intl.format(week.counts.unknown),
          })}
        </p>
      ) : null}
      {week.provisional ? <p>{tMembers("provisionalHint")}</p> : null}
      {week.modelVersion === 2 && sequence ? (
        <div className="space-y-1">
          {sequence.demotion.progress === null && !sequence.demotion.episode ? (
            <p>{t("progressUnknown")}</p>
          ) : (
            <p>
              {t(sequence.demotion.unit === "days" ? "demotionDays" : "demotionWeeks", {
                count: intl.format(
                  sequence.demotion.episode
                    ? sequence.demotion.episode.length
                    : sequence.demotion.progress ?? 0,
                ),
                required: intl.format(sequence.demotion.length),
              })}
            </p>
          )}
          {sequence.promotion.progress !== null && week.signal.kind === "promotion" ? (
            <p>
              {t(sequence.promotion.unit === "days" ? "promotionDays" : "promotionWeeks", {
                count: intl.format(sequence.promotion.progress),
                required: intl.format(sequence.promotion.length),
              })}
            </p>
          ) : null}
          {sequence.demotion.episode ? (
            <div>
              <p className="font-medium">{t("contributingPeriods")}</p>
              <ul className="list-inside list-disc">
                {sequence.demotion.episode.map((unit) => (
                  <li key={unit}>
                    <time dateTime={unit}>{date(unit)}</time>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {sequence.demotion.recoveredAfter.length > 0 ? <p>{t("recovered")}</p> : null}
        </div>
      ) : null}
      {week.signal.kind === "promotion" ? <p>{t("advisoryOnly")}</p> : null}
      {week.correctionReview && week.settled ? (
        <p className="text-hq-danger">{t("correctedAfterAction")}</p>
      ) : null}
      {week.settled ? (
        <p>
          {all("vsCompliance.actionSaved")}
          {week.settled.targetRank !== null
            ? ` · ${tMembers("rankLabel", { rank: week.settled.targetRank })}`
            : null}
          {week.settled.syncStatus
            ? ` · ${all(`timeOff.sync.${syncLabel(week.settled.syncStatus)}`)}`
            : null}
        </p>
      ) : null}
    </div>
  );
}

function ActionRecommendation({ week, currentRank }: { week: VsMemberDetailWeek; currentRank: number | null }) {
  const t = useTranslations("vsPerformance.member");
  const tMembers = useTranslations("vsPerformance.members");
  const tCompliance = useTranslations("vsCompliance");
  return (
    <div className="space-y-1 text-sm">
      <p>
        {t("currentRank")}:{" "}
        {currentRank !== null
          ? tMembers("rankLabel", { rank: currentRank })
          : tMembers("rankUnknown")}
      </p>
      {week.signal.kind === "review_ready" && week.signal.targetRank !== null ? (
        <p className="font-semibold">
          {tCompliance("demote", { rank: tMembers("rankLabel", { rank: week.signal.targetRank }) })}
        </p>
      ) : null}
      {week.signal.kind === "removal_review" ? (
        <p className="font-semibold">{tCompliance("remove")}</p>
      ) : null}
    </div>
  );
}

function RevisionHistory({ memberId, weekStart }: { memberId: string; weekStart: string }) {
  const t = useTranslations("vsPerformance.member");
  const tMembers = useTranslations("vsPerformance.members");
  const tActions = useTranslations("vsPerformance.actions");
  const all = useTranslations();
  const locale = useLocale();
  const intl = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<VsMemberRevisionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestSeq = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(
    async (nextPage: number) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(
          `/api/vs-performance/members/${encodeURIComponent(memberId)}/revisions?weekStart=${encodeURIComponent(weekStart)}&page=${nextPage}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as VsMemberRevisionsResponse;
        if (body.memberId !== memberId || body.weekStart !== weekStart) throw new Error("stale");
        if (seq !== requestSeq.current) return;
        setData(body);
        setPage(nextPage);
      } catch {
        if (seq === requestSeq.current) setError(true);
      } finally {
        inFlight.current = false;
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [memberId, weekStart],
  );

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${value}T12:00:00Z`),
    );
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );

  return (
    <details
      className="rounded border border-hq-border p-2 text-sm"
      data-testid="vs-member-evidence-history"
      onToggle={(event) => {
        if (event.currentTarget.open && !data && !loading && !error) void load(1);
      }}
    >
      <summary className="cursor-pointer">{t("evidenceHistory")}</summary>
      <div className="mt-3 space-y-3">
        {loading ? <p role="status">{tActions("loading")}</p> : null}
        {error ? (
          <div className="flex items-center gap-3" role="alert">
            <p className="text-hq-danger">{t("historyLoadFailed")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load(page)}>
              {tActions("retry")}
            </Button>
          </div>
        ) : null}
        {data ? (
          data.revisions.length === 0 ? (
            <p>{t("noEvidenceHistory")}</p>
          ) : (
            <ol className="space-y-2">
              {data.revisions.map((revision, index) => (
                <li
                  key={`${revision.recordedAt}:${revision.version}:${index}`}
                  className="rounded border border-hq-border p-2"
                >
                  <p>
                    <time dateTime={revision.recordedDate}>{date(revision.recordedDate)}</time>
                    {" · "}
                    {revision.period === "weekly" ? tMembers("reportedTotal") : null}
                    {revision.period === "weekly" ? " · " : ""}
                    {all("shell.version", { version: intl.format(revision.version) })}
                  </p>
                  <p className="tabular-nums">
                    {revision.score === null
                      ? all("commandersIndex.unreportedShort")
                      : intl.format(BigInt(revision.score))}
                    {" · "}
                    {revision.manual
                      ? t("manualSource")
                      : revision.origin === "derived" ? tMembers("derived") : all("vsPerformance.results.sourceHq")}
                    {revision.actorName ? ` · ${revision.actorName}` : ""}
                  </p>
                  {revision.manual && revision.reason ? (
                    <p className="text-xs text-hq-fg-muted">{revision.reason}</p>
                  ) : null}
                  <p className="text-xs text-hq-fg-muted">
                    <time dateTime={revision.recordedAt}>{dateTime(revision.recordedAt)}</time>
                  </p>
                </li>
              ))}
            </ol>
          )
        ) : null}
        {data && (page > 1 || data.hasMore) ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => void load(page - 1)}
            >
              {tMembers("previousPage")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !data.hasMore}
              onClick={() => void load(page + 1)}
            >
              {tMembers("nextPage")}
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function DecisionHistory({ eventId, memberId, weekEnding }: { eventId: string | null; memberId: string; weekEnding: string }) {
  const t = useTranslations("vsPerformance.member");
  const tActions = useTranslations("vsPerformance.actions");
  const all = useTranslations();
  const [history, setHistory] = useState<VsComplianceHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestSeq = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current || !eventId) return;
    inFlight.current = true;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(false);
    try {
      const payload = await fetch(`/api/vs-compliance?eventId=${encodeURIComponent(eventId)}`, {
        cache: "no-store",
      }).then((response) => readComplianceResponse(response, all("statSync.actionFailed")));
      if (!isComplianceHistory(payload) || payload.eventId !== eventId || payload.memberId !== memberId || payload.weekEnding !== weekEnding)
        throw new Error("stale");
      if (seq === requestSeq.current) setHistory(payload);
    } catch {
      if (seq === requestSeq.current) setError(true);
    } finally {
      inFlight.current = false;
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [eventId, memberId, weekEnding, all]);

  return (
    <details
      className="rounded border border-hq-border p-2 text-sm"
      data-testid="vs-member-decision-history"
      onToggle={(event) => {
        if (event.currentTarget.open && !history && !loading && !error) void load();
      }}
    >
      <summary className="cursor-pointer">{t("decisionHistory")}</summary>
      <div className="mt-3 space-y-3">
        {!eventId ? <p>{t("noDecisionHistory")}</p> : null}
        {loading ? <p role="status">{tActions("loading")}</p> : null}
        {error ? (
          <div className="flex items-center gap-3" role="alert">
            <p className="text-hq-danger">{t("historyLoadFailed")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {tActions("retry")}
            </Button>
          </div>
        ) : null}
        {history ? (
          history.actions.length === 0 ? (
            <p>{t("noDecisionHistory")}</p>
          ) : (
            <ComplianceHistoryRecords history={history} />
          )
        ) : null}
        {eventId ? (
          <button
            type="button"
            disabled={loading}
            className={buttonClass}
            onClick={() => void load()}
          >
            {all("timeOff.unexpectedReport.refresh")}
          </button>
        ) : null}
      </div>
    </details>
  );
}

export function VsMemberDetailClient({ memberId, weekStart }: { memberId: string; weekStart: string }) {
  const t = useTranslations("vsPerformance.member");
  const tMembers = useTranslations("vsPerformance.members");
  const tActions = useTranslations("vsPerformance.actions");
  const tErrors = useTranslations("vsPerformance.errors");
  const tWeekdays = useTranslations("trains.weekdays");
  const tCompliance = useTranslations("vsCompliance");
  const all = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const intl = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Etc/GMT+2" }),
    [locale],
  );
  const joinedAtFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Etc/GMT+2" }),
    [locale],
  );
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${value}T12:00:00Z`),
    );

  const [data, setData] = useState<VsMemberDetailResponse | null>(null);
  const [historyExtra, setHistoryExtra] = useState<VsMemberHistoryWeek[]>([]);
  const [historyNext, setHistoryNext] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [selection, setSelection] = useState<{
    operation: "complete" | "waive";
    row: ConfirmationTarget;
    week: VsMemberDetailWeek;
    currentRank: number | null;
  } | null>(null);
  const requestSeq = useRef(0);
  const historySeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vs-performance/members/${encodeURIComponent(memberId)}?${vsMemberDetailApiParams(weekStart)}`,
        { cache: "no-store" },
      );
      if (seq !== requestSeq.current) return;
      if (res.status === 404) {
        setData(null);
        setError("notFound");
        return;
      }
      if (res.status === 403) {
        setData(null);
        setError("forbidden");
        return;
      }
      if (!res.ok) {
        setData(null);
        setError("load");
        return;
      }
      const body = (await res.json()) as VsMemberDetailResponse;
      if (body.memberId !== memberId || body.weekStart !== weekStart) {
        setData(null);
        setError("load");
        return;
      }
      setData(body);
      setHistoryExtra([]);
      setHistoryNext(body.history.nextBefore);
    } catch {
      if (seq === requestSeq.current) {
        setData(null);
        setError("load");
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [memberId, weekStart]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const loadOlder = useCallback(async () => {
    if (!historyNext) return;
    const seq = ++historySeq.current;
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const res = await fetch(
        `/api/vs-performance/members/${encodeURIComponent(memberId)}?${vsMemberDetailApiParams(weekStart, historyNext)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as VsMemberHistoryPage;
      if (body.memberId !== memberId || body.weekStart !== weekStart) throw new Error("stale");
      if (seq !== historySeq.current) return;
      setHistoryExtra((existing) => [...existing, ...body.history.weeks]);
      setHistoryNext(body.history.nextBefore);
    } catch {
      if (seq === historySeq.current) setHistoryError(true);
    } finally {
      if (seq === historySeq.current) setHistoryLoading(false);
    }
  }, [historyNext, memberId, weekStart]);

  const backHref = `/vs-performance?week=${weekStart}`;
  const onBack = (event: React.MouseEvent<HTMLAnchorElement>) => {
    let stored: { memberId?: string; path?: string } | null = null;
    try {
      const raw = window.sessionStorage.getItem("vs-member-focus");
      stored = raw ? (JSON.parse(raw) as { memberId?: string; path?: string }) : null;
    } catch {
      stored = null;
    }
    if (!stored || stored.memberId !== memberId || typeof stored.path !== "string") return;
    let url: URL;
    try {
      url = new URL(stored.path, window.location.origin);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return;
    const pathOnly = url.pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "");
    if (pathOnly !== "/vs-performance") return;
    const allowedKeys = new Set(["week", "q", "status", "rank", "excusal", "signal", "sort", "direction", "page", "pageSize"]);
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams) if (allowedKeys.has(key)) params.append(key, value);
    event.preventDefault();
    router.push(`/vs-performance${params.size > 0 ? `?${params.toString()}` : ""}`);
  };

  const openAction = (operation: "complete" | "waive") => {
    if (!data?.action) return;
    setSelection({
      operation,
      week: data.week,
      currentRank: data.member.currentRank,
      row: {
        id: data.action.eventId,
        memberId: data.memberId,
        memberName: data.member.name,
        weekEnding: data.weekEnding,
        confirmationBasis: data.action.confirmationBasis,
      },
    });
  };

  const policyKey = data ? vsMemberPolicyLineKey(data.policy) : null;
  const sourceKey = data ? vsMemberSourceKey(data.source) : null;
  const allWeeks = data ? [...data.history.weeks, ...historyExtra] : [];

  return (
    <Suspense fallback={null}>
    <DirtyNavigation
      labels={{
        title: all("notes.editor.discardTitle"),
        body: all("notes.editor.discardBody"),
        keepEditing: all("notes.editor.keepEditing"),
        discard: all("notes.editor.discard"),
        saveFailed: all("notes.saveFailed"),
      }}
    >
    <div className="mx-auto max-w-3xl space-y-6" data-testid="vs-member-detail">
      <div>
        <Link
          href={backHref}
          onClick={onBack}
          className="rounded text-sm text-hq-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-hq-accent"
        >
          {t("back")}
        </Link>
      </div>

      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-hq-border bg-hq-surface p-5" role="alert">
          <p className="text-sm text-hq-danger">
            {error === "notFound" ? t("notFound") : error === "forbidden" ? tErrors("forbidden") : t("detailLoadFailed")}
          </p>
          {error === "load" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {tActions("retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {loading && !data ? (
        <p role="status" className="py-6 text-center text-sm text-hq-fg-muted">
          {tActions("loading")}
        </p>
      ) : null}

      {data ? (
        <>
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold text-hq-fg">
              {t("title", { name: data.member.name })}
            </h1>
            <p className="text-sm text-hq-fg-muted">
              {t("weekEnding", { date: date(data.weekEnding) })}
              {" · "}
              {data.live ? tMembers("inProgress") : tMembers("closed")}
            </p>
            <p className="text-sm">
              {t("currentRank")}:{" "}
              {data.member.currentRank !== null
                ? tMembers("rankLabel", { rank: data.member.currentRank })
                : tMembers("rankUnknown")}
              {data.member.rosterStatus === "former" ? ` · ${tMembers("formerMember")}` : ""}
            </p>
            {data.member.joinedAt ? (
              <p className="text-sm text-hq-fg-muted">
                {all("supportTeams.tenure")}: {joinedAtFmt.format(new Date(data.member.joinedAt))}
                {" · "}
                {all("timeOff.workflow.serverTime")}
              </p>
            ) : (
              <p className="text-sm text-hq-fg-muted">{t("tenureUnknown")}</p>
            )}
          </header>

          <section aria-labelledby="vs-member-week-heading" className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="vs-member-week-heading" className="text-base font-semibold text-hq-fg">
                {t("selectedWeek")}
              </h2>
              <span className="rounded-full bg-hq-surface-muted px-2.5 py-0.5 text-xs font-medium text-hq-fg-muted">
                {tMembers(VS_MEMBER_STATUS_KEYS[data.week.status])}
              </span>
            </div>
            <div className="space-y-1 text-xs text-hq-fg-muted">
              <p>
                {policyKey === "policyLine"
                  ? tMembers("policyLine", {
                      minimum: data.policy.dailyThreshold !== null ? intl.format(data.policy.dailyThreshold) : "—",
                      allowed: data.policy.allowedMissedDays ?? 0,
                    })
                  : tMembers(policyKey ?? "noPolicy")}
              </p>
              {data.live ? <p>{tMembers("provisionalHint")}</p> : null}
              {sourceKey === "sourceChecked" && data.source.verifiedAt ? (
                <p>{tMembers("sourceChecked", { time: dateTimeFmt.format(new Date(data.source.verifiedAt)) })}</p>
              ) : null}
              {sourceKey === "sourceStale" ? <p role="status">{tMembers("sourceStale")}</p> : null}
            </div>

            {data.week.days.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="vs-member-day-grid">
                {data.week.days.map((day, index) => (
                  <li
                    key={day.date}
                    className="flex flex-col items-center gap-1 rounded-lg border border-hq-border p-2"
                  >
                    <span className="text-xs text-hq-fg-muted">{tWeekdays(DAY_KEYS[index])}</span>
                    <VsDayBadge day={day} dayName={tWeekdays(DAY_KEYS[index])} />
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="space-y-1 text-sm">
              <p className="font-medium text-hq-fg">{t("weekResult")}</p>
              {data.week.excusal !== "none" && VS_MEMBER_EXCUSAL_KEYS[data.week.excusal] ? (
                <p>{tMembers(VS_MEMBER_EXCUSAL_KEYS[data.week.excusal]!)}</p>
              ) : null}
              {data.week.reportedTotal !== null ? (
                <p>
                  {tMembers("reportedTotal")}: {formatVsScore(data.week.reportedTotal, locale)}
                </p>
              ) : null}
              {data.week.dailySubtotal !== null ? (
                <p>
                  {t("dailySubtotal")}: {formatVsScore(data.week.dailySubtotal, locale)}
                  {data.week.knownDays < 6
                    ? ` · ${tMembers("partialTotal", { count: intl.format(data.week.knownDays) })}`
                    : ""}
                </p>
              ) : null}
              {data.week.modelVersion === 1 && data.week.score !== null && data.week.threshold !== null ? (
                <p>
                  {all("vsCompliance.weekSummary", {
                    date: date(data.weekEnding),
                    score: formatVsScore(data.week.score, locale),
                    minimum: intl.format(data.week.threshold),
                  })}
                </p>
              ) : null}
              <ActionRecommendation week={data.week} currentRank={data.member.currentRank} />
              <SequenceFacts week={data.week} />
            </div>

            {data.edit ? (
              <VsMemberScoreEditor
                memberId={memberId}
                weekStart={weekStart}
                edit={data.edit}
                onSaved={() => void load()}
              />
            ) : null}

            {data.action ? (
              <div className="flex flex-wrap gap-2">
                {data.action.canConfirm ? (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => openAction("complete")}
                  >
                    {tCompliance("confirm")}
                  </button>
                ) : null}
                {data.action.canWaive ? (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => openAction("waive")}
                  >
                    {tCompliance("waive")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="vs-member-history-heading" className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4">
            <h2 id="vs-member-history-heading" className="text-base font-semibold text-hq-fg">
              {t("history")}
            </h2>
            {allWeeks.length === 0 ? (
              <p className="text-sm text-hq-fg-muted">{t("noHistory")}</p>
            ) : (
              <ol className="space-y-2" data-testid="vs-member-history-list">
                {allWeeks.map((week) => (
                  <li key={week.weekEnding} className="space-y-1 rounded-lg border border-hq-border p-3 text-sm">
                    <p>
                      <time dateTime={week.weekEnding} className="font-medium">
                        {t("weekEnding", { date: date(week.weekEnding) })}
                      </time>
                      {" · "}
                      {tMembers(VS_MEMBER_STATUS_KEYS[week.status])}
                      {week.policyVersion !== null
                        ? ` · ${t("policyVersion", { version: intl.format(week.policyVersion) })}`
                        : ""}
                    </p>
                    {week.modelVersion === 2 && week.counts ? (
                      <p className="text-xs text-hq-fg-muted">
                        {t("dayCounts", {
                          met: intl.format(week.counts.met),
                          missed: intl.format(week.counts.missed),
                          excused: intl.format(week.counts.excused),
                          unknown: intl.format(week.counts.unknown),
                        })}
                      </p>
                    ) : null}
                    {week.modelVersion === 1 && week.score !== null && week.threshold !== null ? (
                      <p className="text-xs text-hq-fg-muted">
                        {all("vsCompliance.weekSummary", {
                          date: date(week.weekEnding),
                          score: formatVsScore(week.score, locale),
                          minimum: intl.format(week.threshold),
                        })}
                      </p>
                    ) : null}
                    {week.settled ? (
                      <p className="text-xs text-hq-fg-muted">
                        {all("vsCompliance.actionSaved")}
                        {week.settled.targetRank !== null
                          ? ` · ${tMembers("rankLabel", { rank: week.settled.targetRank })}`
                          : ""}
                        {week.settled.syncStatus
                          ? ` · ${all(`timeOff.sync.${syncLabel(week.settled.syncStatus)}`)}`
                          : ""}
                      </p>
                    ) : null}
                    {week.correctionReview ? (
                      <p className="text-xs text-hq-danger">{t("correctedAfterAction")}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {historyNext ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={historyLoading}
                onClick={() => void loadOlder()}
              >
                {historyLoading ? tActions("loading") : t("olderWeeks")}
              </Button>
            ) : null}
            {historyError ? (
              <div className="flex items-center gap-3" role="alert">
                <p className="text-sm text-hq-danger">{t("historyLoadFailed")}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadOlder()}>
                  {tActions("retry")}
                </Button>
              </div>
            ) : null}
            <RevisionHistory
              key={`${memberId}:${weekStart}:${data.inputVersion}`}
              memberId={memberId}
              weekStart={weekStart}
            />
            <DecisionHistory
              key={`${memberId}:${data.weekEnding}:${data.inputVersion}`}
              eventId={data.eventId}
              memberId={memberId}
              weekEnding={data.weekEnding}
            />
          </section>
        </>
      ) : null}

      {selection ? (
        <ConfirmationDialog
          row={selection.row}
          operation={selection.operation}
          facts={
            <>
              <ActionRecommendation week={selection.week} currentRank={selection.currentRank} />
              <SequenceFacts week={selection.week} weekEnding={selection.row.weekEnding} legacySummary />
            </>
          }
          onSaved={() => void load()}
          onClose={() => {
            setSelection(null);
            void load();
          }}
        />
      ) : null}
    </div>
    </DirtyNavigation>
    </Suspense>
  );
}
