"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type {
  AnalyticsResponse,
  PassKeyRow,
  BucketRow,
} from "@/lib/video/video-jobs-analytics.server";
import type { RosterOcrEvalResponse } from "@/app/api/admin/video-jobs/roster-ocr-eval/route";
import type { DepositSlipOcrEvalResponse } from "@/app/api/admin/video-jobs/deposit-slip-ocr-eval/route";
import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import {
  ADMIN_VIDEO_JOBS_CONSOLE,
  type VideoJobsConsoleConfig,
} from "@/lib/video/video-jobs-console.shared";

const QUALITY_BUCKET_COLORS: Record<string, string> = {
  perfect: "text-hq-green",
  q1: "text-hq-green",
  q2: "text-[#d29922]",
  q3: "text-[#d29922]",
  q4: "text-hq-danger",
  q5: "text-hq-danger",
  dropped_the_ball: "text-hq-danger",
};

const BUCKET_ORDER = ["perfect", "q1", "q2", "q3", "q4", "q5", "dropped_the_ball"];

const REASON_LABELS: Record<string, string> = {
  member_match: "Member match",
  score_parse: "Score parse",
  wrong_event: "Wrong event",
  frame_quality: "Frame quality",
  other: "Other",
};

function pct(n: number | null | undefined, d: number | null | undefined): string {
  if (!d || n == null) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="text-xs uppercase tracking-wide text-hq-fg-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-hq-fg">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-hq-fg-muted">{sub}</div>}
    </div>
  );
}

function PassKeyTable({
  rows,
  bucketRows,
  scoreTarget,
}: {
  rows: PassKeyRow[];
  bucketRows: BucketRow[];
  scoreTarget: string;
}) {
  const t = useTranslations("admin.analyticsPage");
  const bucketMap = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const b of bucketRows) {
      if (b.scoreTarget !== scoreTarget) continue;
      const key = b.passKey;
      const existing = m.get(key) ?? {};
      existing[b.qualityBucket] = (existing[b.qualityBucket] ?? 0) + b.count;
      m.set(key, existing);
    }
    return m;
  }, [bucketRows, scoreTarget]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-hq-border text-hq-fg-muted uppercase tracking-wide">
            <th className="pb-2 text-left">{t("col.pass")}</th>
            <th className="pb-2 text-right">{t("col.jobs")}</th>
            <th className="pb-2 text-right">{t("col.rated")}</th>
            <th className="pb-2 text-right">{t("col.thumbsUp")}</th>
            <th className="pb-2 text-right">{t("col.avgQuality")}</th>
            <th className="pb-2 text-right">{t("col.userSelected")}</th>
            <th className="pb-2 text-right">{t("col.sysRecommended")}</th>
            <th className="pb-2 text-right">{t("col.agreement")}</th>
            <th className="pb-2 text-left">{t("col.buckets")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const buckets = bucketMap.get(row.passKey) ?? {};
            return (
              <tr key={row.passKey} className="border-b border-hq-surface-muted hover:bg-hq-surface transition-colors">
                <td className="py-2 font-mono text-[#79c0ff]">{row.passKey}</td>
                <td className="py-2 text-right text-hq-fg">{row.total}</td>
                <td className="py-2 text-right text-hq-fg-muted">{row.rated}</td>
                <td className="py-2 text-right font-medium text-hq-fg">
                  {pct(row.thumbsUp, row.rated)}
                </td>
                <td className="py-2 text-right text-hq-fg-muted">
                  {row.avgQualityScore != null ? row.avgQualityScore.toFixed(2) : "—"}
                </td>
                <td className="py-2 text-right text-hq-fg-muted">{row.userSelected}</td>
                <td className="py-2 text-right text-hq-fg-muted">{row.sysRecommended}</td>
                <td className="py-2 text-right text-hq-fg-muted">
                  {pct(
                    row.userSelected > 0 && row.sysRecommended > 0
                      ? Math.min(row.userSelected, row.sysRecommended)
                      : null,
                    row.userSelected > 0 ? row.userSelected : null,
                  )}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {BUCKET_ORDER.filter((b) => buckets[b]).map((b) => (
                      <span key={b} className={`text-[10px] ${QUALITY_BUCKET_COLORS[b]}`}>
                        {b}:{buckets[b]}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AdminVideoAnalyticsView({
  config = ADMIN_VIDEO_JOBS_CONSOLE,
}: {
  config?: VideoJobsConsoleConfig;
}) {
  const t = useTranslations("admin.analyticsPage");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [rosterEval, setRosterEval] = useState<RosterOcrEvalResponse | null>(null);
  const [depositSlipEval, setDepositSlipEval] = useState<DepositSlipOcrEvalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [scoreTarget, setScoreTarget] = useState("");
  const [passKey, setPassKey] = useState("");
  const [days, setDays] = useState("30");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (scoreTarget) params.set("scoreTarget", scoreTarget);
      if (passKey) params.set("passKey", passKey);
      if (days && days !== "0") params.set("days", days);
      const res = await fetch(`${config.apiBase}/analytics?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const rosterParams = new URLSearchParams();
      if (days && days !== "0") rosterParams.set("days", days);
      const rosterEvalPromise = config.includeRosterOcrEval
        ? fetch(`/api/admin/video-jobs/roster-ocr-eval?${rosterParams}`)
        : Promise.resolve(null);
      const depositSlipEvalPromise = config.includeDepositSlipOcrEval
        ? fetch(`/api/admin/video-jobs/deposit-slip-ocr-eval?${rosterParams}`)
        : Promise.resolve(null);
      const [analyticsJson, rosterEvalRes, depositSlipEvalRes] = await Promise.all([
        res.json() as Promise<AnalyticsResponse>,
        rosterEvalPromise,
        depositSlipEvalPromise,
      ]);
      setData(analyticsJson);
      if (rosterEvalRes?.ok) {
        setRosterEval((await rosterEvalRes.json()) as RosterOcrEvalResponse);
      } else {
        setRosterEval(null);
      }
      if (depositSlipEvalRes?.ok) {
        setDepositSlipEval((await depositSlipEvalRes.json()) as DepositSlipOcrEvalResponse);
      } else {
        setDepositSlipEval(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [
    scoreTarget,
    passKey,
    days,
    t,
    config.apiBase,
    config.includeRosterOcrEval,
    config.includeDepositSlipOcrEval,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch {
        // handled inside load
      }
    })();
  }, [load]);

  // Derive available scoreTargets and passKeys from loaded data
  const availableTargets = useMemo(
    () => [...new Set(data?.byPassKey.map((r) => r.scoreTarget).filter(Boolean) ?? [])].sort(),
    [data],
  );
  const availablePassKeys = useMemo(
    () =>
      [
        ...new Set(
          data?.byPassKey
            .filter((r) => !scoreTarget || r.scoreTarget === scoreTarget)
            .map((r) => r.passKey)
            .filter(Boolean) ?? [],
        ),
      ].sort(),
    [data, scoreTarget],
  );

  // Group byPassKey rows by scoreTarget
  const passKeyByTarget = useMemo(() => {
    const m = new Map<string, PassKeyRow[]>();
    for (const row of data?.byPassKey ?? []) {
      const existing = m.get(row.scoreTarget) ?? [];
      existing.push(row);
      m.set(row.scoreTarget, existing);
    }
    return m;
  }, [data]);

  // Group ratingReasons by scoreTarget
  const reasonsByTarget = useMemo(() => {
    const m = new Map<string, { reason: string; count: number }[]>();
    for (const row of data?.byRatingReason ?? []) {
      const existing = m.get(row.scoreTarget) ?? [];
      existing.push({ reason: row.ratingReason, count: row.count });
      m.set(row.scoreTarget, existing);
    }
    return m;
  }, [data]);

  const targetList = useMemo(
    () =>
      scoreTarget
        ? [scoreTarget]
        : [...passKeyByTarget.keys()].sort(),
    [passKeyByTarget, scoreTarget],
  );

  const { summary, recommendationAccuracy, mixedEventTypes } = data ?? {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-hq-fg">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
          {config.showFleetAdminLinks ? (
            <p className="mt-2 text-sm">
              <Link
                href="/admin/guides/video-pipeline"
                className="text-hq-accent hover:underline"
              >
                Video pipeline configs and experiments guide
              </Link>
            </p>
          ) : null}
        </div>
        {config.showFleetAdminLinks ? (
          <Link
            href="/admin/experiments"
            className="shrink-0 rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent transition-colors"
          >
            {t("experimentsLink")} →
          </Link>
        ) : (
          <Link
            href={config.listPath}
            className="shrink-0 rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent transition-colors"
          >
            ← {t("backToJobs")}
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hq-border bg-hq-surface p-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-hq-fg-muted">{t("filter.scoreTarget")}</label>
          <select
            value={scoreTarget}
            onChange={(e) => { setScoreTarget(e.target.value); setPassKey(""); }}
            className="rounded border border-hq-border bg-hq-canvas px-2 py-1 text-xs text-hq-fg focus:border-hq-accent focus:outline-none"
          >
            <option value="">{t("filter.allTargets")}</option>
            {availableTargets.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-hq-fg-muted">{t("filter.passKey")}</label>
          <select
            value={passKey}
            onChange={(e) => setPassKey(e.target.value)}
            className="rounded border border-hq-border bg-hq-canvas px-2 py-1 text-xs font-mono text-hq-fg focus:border-hq-accent focus:outline-none"
          >
            <option value="">{t("filter.allPasses")}</option>
            {availablePassKeys.map((pk) => (
              <option key={pk} value={pk}>{pk}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-hq-fg-muted">{t("filter.window")}</label>
          {(["7", "30", "90", "0"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${days === d ? "border-hq-accent text-hq-selected-fg bg-hq-selected" : "border-hq-border text-hq-fg-muted hover:border-hq-accent hover:text-hq-accent"}`}
            >
              {d === "0" ? t("filter.allTime") : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Mixed event types warning */}
      {mixedEventTypes && (
        <div className="rounded border border-[#d29922] bg-[#d2992208] px-4 py-3 text-sm text-[#d29922]">
          ⚠ {t("mixedWarning")}
        </div>
      )}

      {error && <p className="text-sm text-hq-danger">{error}</p>}
      {loading && <p className="text-sm text-hq-fg-muted">{t("loading")}</p>}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label={t("kpi.totalRated")}
              value={String(summary?.ratedJobs ?? 0)}
              sub={`${t("kpi.of")} ${summary?.totalJobs ?? 0} ${t("kpi.jobs")}`}
            />
            <KpiCard
              label={t("kpi.thumbsUpRate")}
              value={pct(summary?.thumbsUp, summary?.ratedJobs)}
              sub={scoreTarget ? scoreTarget : (mixedEventTypes ? `⚠ ${t("kpi.mixed")}` : undefined)}
            />
            <KpiCard
              label={t("kpi.recommendationAccuracy")}
              value={pct(recommendationAccuracy?.accurate, recommendationAccuracy?.totalDecided)}
              sub={`${recommendationAccuracy?.totalDecided ?? 0} ${t("kpi.decided")}`}
            />
            <KpiCard
              label={t("kpi.overrideRate")}
              value={pct(recommendationAccuracy?.overridden, recommendationAccuracy?.totalDecided)}
              sub={`${recommendationAccuracy?.overridden ?? 0} ${t("kpi.overrides")}`}
            />
          </div>

          {config.includeRosterOcrEval &&
          (!scoreTarget || scoreTarget === "member-roster-video") &&
          rosterEval ? (
            <section className="space-y-4 rounded-lg border border-hq-border bg-hq-surface p-4">
              <div>
                <h2 className="text-sm font-semibold text-hq-fg">
                  {t("rosterOcrEval.title")}
                </h2>
                <p className="mt-1 text-xs text-hq-fg-muted">{t("rosterOcrEval.subtitle")}</p>
              </div>
              {rosterEval.jobCount === 0 ? (
                <p className="text-xs text-hq-fg-muted">{t("rosterOcrEval.empty")}</p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <KpiCard
                      label={t("rosterOcrEval.jobCount")}
                      value={String(rosterEval.jobCount)}
                    />
                    <KpiCard
                      label={t("rosterOcrEval.nameRecall")}
                      value={pct(rosterEval.avgNameRecall, 1)}
                    />
                    <KpiCard
                      label={t("rosterOcrEval.namePrecision")}
                      value={pct(rosterEval.avgNamePrecision, 1)}
                    />
                    <KpiCard
                      label={t("rosterOcrEval.rankAgreement")}
                      value={pct(rosterEval.avgRankAgreement, 1)}
                    />
                    <KpiCard
                      label={t("rosterOcrEval.powerAgreement")}
                      value={pct(rosterEval.avgPowerAgreement, 1)}
                    />
                    <KpiCard
                      label={t("rosterOcrEval.levelAgreement")}
                      value={pct(rosterEval.avgLevelAgreement, 1)}
                    />
                  </div>
                  {rosterEval.byPassKey.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-hq-border text-hq-fg-muted uppercase tracking-wide">
                            <th className="pb-2 text-left">{t("rosterOcrEval.colPass")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.colJobs")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.nameRecall")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.namePrecision")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.rankAgreement")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rosterEval.byPassKey.map((row) => (
                            <tr key={row.tessPassKey} className="border-b border-hq-surface-muted">
                              <td className="py-2 font-mono text-[#79c0ff]">{row.tessPassKey}</td>
                              <td className="py-2 text-right text-hq-fg">{row.jobCount}</td>
                              <td className="py-2 text-right text-hq-fg-muted">
                                {pct(row.avgNameRecall, 1)}
                              </td>
                              <td className="py-2 text-right text-hq-fg-muted">
                                {pct(row.avgNamePrecision, 1)}
                              </td>
                              <td className="py-2 text-right text-hq-fg-muted">
                                {pct(row.avgRankAgreement, 1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {rosterEval.dailySeries.length > 0 ? (
                    <div className="overflow-x-auto">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
                        {t("rosterOcrEval.dailyTrend")}
                      </h3>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-hq-border text-hq-fg-muted uppercase tracking-wide">
                            <th className="pb-2 text-left">{t("rosterOcrEval.colDate")}</th>
                            <th className="pb-2 text-left">{t("rosterOcrEval.colPass")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.colJobs")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.nameRecall")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.namePrecision")}</th>
                            <th className="pb-2 text-right">{t("rosterOcrEval.rankAgreement")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rosterEval.dailySeries.map((row) => (
                            <tr key={`${row.date}-${row.passKey}`} className="border-b border-hq-surface-muted">
                              <td className="py-2 text-hq-fg">{row.date}</td>
                              <td className="py-2 font-mono text-[#79c0ff]">{row.passKey}</td>
                              <td className="py-2 text-right text-hq-fg">{row.jobCount}</td>
                              <td className="py-2 text-right text-hq-fg-muted">{pct(row.nameRecall, 1)}</td>
                              <td className="py-2 text-right text-hq-fg-muted">{pct(row.namePrecision, 1)}</td>
                              <td className="py-2 text-right text-hq-fg-muted">{pct(row.rankAgreement, 1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {config.includeDepositSlipOcrEval &&
          (!scoreTarget || scoreTarget === BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET) &&
          depositSlipEval ? (
            <section className="space-y-4 rounded-lg border border-hq-border bg-hq-surface p-4">
              <div>
                <h2 className="text-sm font-semibold text-hq-fg">
                  {t("depositSlipEval.title")}
                </h2>
                <p className="mt-1 text-xs text-hq-fg-muted">{t("depositSlipEval.subtitle")}</p>
              </div>
              {depositSlipEval.jobCount === 0 ? (
                <p className="text-xs text-hq-fg-muted">{t("depositSlipEval.empty")}</p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <KpiCard
                      label={t("depositSlipEval.jobCount")}
                      value={String(depositSlipEval.jobCount)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.rowRecall")}
                      value={pct(depositSlipEval.avgRowRecall, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.rowPrecision")}
                      value={pct(depositSlipEval.avgRowPrecision, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.depositAtAgreement")}
                      value={pct(depositSlipEval.avgDepositAtAgreement, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.primaryMissingDepositAtRate")}
                      value={pct(depositSlipEval.avgPrimaryMissingDepositAtRate, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.shadowMissingDepositAtRate")}
                      value={pct(depositSlipEval.avgShadowMissingDepositAtRate, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.amountAgreement")}
                      value={pct(depositSlipEval.avgAmountAgreement, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.termDaysAgreement")}
                      value={pct(depositSlipEval.avgTermDaysAgreement, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.statusAgreement")}
                      value={pct(depositSlipEval.avgStatusAgreement, 1)}
                    />
                    <KpiCard
                      label={t("depositSlipEval.lineReduction")}
                      value={pct(depositSlipEval.avgLineReductionRate, 1)}
                      sub={
                        depositSlipEval.avgRawLineCount != null &&
                        depositSlipEval.avgUniqueLineCount != null
                          ? `${Math.round(depositSlipEval.avgRawLineCount)} → ${Math.round(depositSlipEval.avgUniqueLineCount)}`
                          : undefined
                      }
                    />
                  </div>
                  {depositSlipEval.dailySeries.length > 0 ? (
                    <div className="overflow-x-auto">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
                        {t("depositSlipEval.dailyTrend")}
                      </h3>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-hq-border text-hq-fg-muted uppercase tracking-wide">
                            <th className="pb-2 text-left">{t("depositSlipEval.colDate")}</th>
                            <th className="pb-2 text-right">{t("depositSlipEval.colJobs")}</th>
                            <th className="pb-2 text-right">{t("depositSlipEval.rowRecall")}</th>
                            <th className="pb-2 text-right">
                              {t("depositSlipEval.primaryMissingDepositAtRate")}
                            </th>
                            <th className="pb-2 text-right">
                              {t("depositSlipEval.shadowMissingDepositAtRate")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {depositSlipEval.dailySeries.map((row) => (
                            <tr key={row.date} className="border-b border-hq-surface-muted">
                              <td className="py-2 text-hq-fg">{row.date}</td>
                              <td className="py-2 text-right text-hq-fg">{row.jobCount}</td>
                              <td className="py-2 text-right text-hq-fg-muted">
                                {pct(row.avgRowRecall, 1)}
                              </td>
                              <td className="py-2 text-right text-hq-fg-muted">
                                {pct(row.avgPrimaryMissingDepositAtRate, 1)}
                              </td>
                              <td className="py-2 text-right text-hq-fg-muted">
                                {pct(row.avgShadowMissingDepositAtRate, 1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {/* Per-scoreTarget sections */}
          {targetList.map((st) => {
            const rows = passKeyByTarget.get(st) ?? [];
            const reasons = reasonsByTarget.get(st) ?? [];
            const totalReasons = reasons.reduce((s, r) => s + r.count, 0);

            return (
              <section key={st} className="space-y-4 rounded-lg border border-hq-border bg-hq-surface p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-hq-fg">
                  <span className="font-mono text-[#79c0ff]">{st}</span>
                  <span className="text-hq-fg-muted font-normal text-xs">— {t("passKeyPerformance")}</span>
                </h2>

                {rows.length === 0 ? (
                  <p className="text-xs text-hq-fg-muted">{t("noData")}</p>
                ) : (
                  <PassKeyTable
                    rows={rows}
                    bucketRows={data.byQualityBucket}
                    scoreTarget={st}
                  />
                )}

                {/* Rating reason breakdown */}
                {reasons.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-hq-fg-muted">
                      {t("ratingReasons")}
                    </h3>
                    <div className="space-y-1.5">
                      {reasons
                        .sort((a, b) => b.count - a.count)
                        .map((r) => (
                          <div key={r.reason} className="flex items-center gap-3">
                            <span className="w-28 shrink-0 text-xs text-hq-fg-muted">
                              {REASON_LABELS[r.reason] ?? r.reason}
                            </span>
                            <div className="flex-1 overflow-hidden rounded-full bg-hq-surface-muted">
                              <div
                                className="h-2 rounded-full bg-hq-danger"
                                style={{
                                  width: `${totalReasons > 0 ? (r.count / totalReasons) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span className="w-8 text-right text-xs text-hq-fg-muted">{r.count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          {targetList.length === 0 && !loading && (
            <p className="text-center py-10 text-sm text-hq-fg-muted">{t("noData")}</p>
          )}
        </>
      )}
    </div>
  );
}
