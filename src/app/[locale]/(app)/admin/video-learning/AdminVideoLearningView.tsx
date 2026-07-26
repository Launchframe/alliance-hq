"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type {
  VideoLearningFleetResponse,
  VideoLearningOfficerDetailResponse,
} from "@/lib/video/video-hygiene-learning.server";

function KpiCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="text-xs uppercase tracking-wide text-hq-fg-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-hq-fg">{value}</div>
    </div>
  );
}

function formatPct(rate: number | null): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(0)}%`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function AdminVideoLearningView() {
  const t = useTranslations("admin.videoLearningPage");
  const [days, setDays] = useState("30");
  const [query, setQuery] = useState("");
  const [fleet, setFleet] = useState<VideoLearningFleetResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] =
    useState<VideoLearningOfficerDetailResponse | null>(null);
  const [detailForUserId, setDetailForUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFleet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (days) params.set("days", days);
      const res = await fetch(`/api/admin/video-learning?${params}`);
      if (!res.ok) throw new Error(await res.text());
      setFleet((await res.json()) as VideoLearningFleetResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [days, t]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadFleet();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [loadFleet]);

  useEffect(() => {
    if (!selectedUserId) return;
    const userId = selectedUserId;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (days) params.set("days", days);
        const res = await fetch(
          `/api/admin/video-learning/${encodeURIComponent(userId)}?${params}`,
        );
        if (!res.ok) throw new Error(await res.text());
        const json =
          (await res.json()) as VideoLearningOfficerDetailResponse;
        if (!cancelled) {
          setDetail(json);
          setDetailForUserId(userId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedUserId, days, t]);

  const visibleDetail =
    selectedUserId && detailForUserId === selectedUserId ? detail : null;

  const filteredOfficers = useMemo(() => {
    const officers = fleet?.officers ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return officers;
    return officers.filter(
      (o) =>
        o.email.toLowerCase().includes(q) ||
        (o.displayName?.toLowerCase().includes(q) ?? false),
    );
  }, [fleet, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-hq-fg-muted">
          {t("daysLabel")}
          <input
            className="mt-1 block w-24 rounded border border-hq-border bg-hq-surface px-2 py-1 text-hq-fg"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
        <label className="text-sm text-hq-fg-muted">
          {t("searchLabel")}
          <input
            className="mt-1 block w-64 max-w-full rounded border border-hq-border bg-hq-surface px-2 py-1 text-hq-fg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </label>
        <button
          type="button"
          className="rounded bg-hq-accent px-3 py-1.5 text-sm font-medium text-hq-accent-fg"
          onClick={() => void loadFleet()}
          disabled={loading}
        >
          {loading ? t("loading") : t("refresh")}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      {fleet ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label={t("kpi.officers")}
            value={String(fleet.summary.officerCount)}
          />
          <KpiCard
            label={t("kpi.improving")}
            value={String(fleet.summary.improvingCount)}
          />
          <KpiCard
            label={t("kpi.regressing")}
            value={String(fleet.summary.regressingCount)}
          />
          <KpiCard
            label={t("kpi.flat")}
            value={String(fleet.summary.flatCount)}
          />
          <KpiCard
            label={t("kpi.adaptBias")}
            value={String(fleet.summary.officersWithAdaptBias)}
          />
          <KpiCard
            label={t("kpi.thrashFlags")}
            value={String(fleet.summary.thrashFlagCount)}
          />
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-hq-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hq-border text-left text-xs uppercase tracking-wide text-hq-fg-muted">
              <th className="px-3 py-2">{t("col.officer")}</th>
              <th className="px-3 py-2 text-right">{t("col.jobs")}</th>
              <th className="px-3 py-2 text-right">{t("col.thumbsUp")}</th>
              <th className="px-3 py-2 text-right">{t("col.quality")}</th>
              <th className="px-3 py-2 text-right">{t("col.reviewMs")}</th>
              <th className="px-3 py-2">{t("col.direction")}</th>
              <th className="px-3 py-2 text-right">{t("col.adapt")}</th>
              <th className="px-3 py-2 text-right">{t("col.flags")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredOfficers.map((officer) => (
              <tr
                key={officer.hqUserId}
                className="cursor-pointer border-b border-hq-border/60 hover:bg-hq-surface"
                onClick={() => setSelectedUserId(officer.hqUserId)}
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-hq-fg">
                    {officer.displayName || officer.email}
                  </div>
                  {officer.displayName ? (
                    <div className="text-xs text-hq-fg-muted">
                      {officer.email}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {officer.jobCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatPct(officer.thumbsUpRate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {officer.avgQualityScore != null
                    ? officer.avgQualityScore.toFixed(2)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMs(officer.medianReviewDurationMs)}
                </td>
                <td className="px-3 py-2">
                  {t(`direction.${officer.learningDirection}`)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {officer.activeAdaptOverlays}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {officer.thrashFlags.length}
                </td>
              </tr>
            ))}
            {filteredOfficers.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-hq-fg-muted"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {visibleDetail ? (
        <section className="space-y-4 rounded-lg border border-hq-border bg-hq-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-hq-fg">
                {visibleDetail.officer.displayName || visibleDetail.officer.email}
              </h2>
              <p className="text-sm text-hq-fg-muted">
                {visibleDetail.officer.email} ·{" "}
                {t(`direction.${visibleDetail.learningDirection}`)}
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-hq-fg-muted underline"
              onClick={() => setSelectedUserId(null)}
            >
              {t("closeDetail")}
            </button>
          </div>

          {visibleDetail.thrashFlags.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-hq-fg">
                {t("thrashTitle")}
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-hq-danger">
                {visibleDetail.thrashFlags.map((flag, idx) => (
                  <li key={`${flag.kind}-${flag.scoreTarget}-${idx}`}>
                    {t(`thrash.${flag.kind}`)} — {flag.scoreTarget}:{" "}
                    {flag.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-hq-fg-muted">{t("thrashEmpty")}</p>
          )}

          <div>
            <h3 className="text-sm font-medium text-hq-fg">
              {t("rewardsTitle")}
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-hq-fg-muted">
                    <th className="py-1">{t("col.target")}</th>
                    <th className="py-1 text-right">{t("col.jobs")}</th>
                    <th className="py-1 text-right">{t("col.thumbsUp")}</th>
                    <th className="py-1 text-right">{t("col.quality")}</th>
                    <th className="py-1 text-right">{t("col.reviewMs")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDetail.rewards.map((row) => (
                    <tr key={row.scoreTarget} className="border-t border-hq-border/50">
                      <td className="py-1 font-mono">{row.scoreTarget}</td>
                      <td className="py-1 text-right">{row.jobCount}</td>
                      <td className="py-1 text-right">
                        {formatPct(row.thumbsUpRate)}
                      </td>
                      <td className="py-1 text-right">
                        {row.avgQualityScore != null
                          ? row.avgQualityScore.toFixed(2)
                          : "—"}
                      </td>
                      <td className="py-1 text-right">
                        {formatMs(row.medianReviewDurationMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-hq-fg">
              {t("eventsTitle")}
            </h3>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-hq-fg-muted">
              {visibleDetail.events.length === 0 ? (
                <li>{t("eventsEmpty")}</li>
              ) : (
                visibleDetail.events.map((event) => (
                  <li key={event.id}>
                    {new Date(event.createdAt).toLocaleString()} · {event.kind}{" "}
                    · {event.scoreTarget}
                    {event.jobId ? (
                      <>
                        {" · "}
                        <Link
                          href={`/admin/video-jobs/${event.jobId}`}
                          className="text-[#79c0ff] underline"
                        >
                          {event.jobId}
                        </Link>
                      </>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-hq-fg">
              {t("jobsTitle")}
            </h3>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {visibleDetail.recentJobs.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/admin/video-jobs/${job.id}`}
                    className="text-[#79c0ff] underline"
                  >
                    {job.id}
                  </Link>{" "}
                  · {job.scoreTarget ?? "—"} · {job.status} ·{" "}
                  {job.rating ?? "unrated"} · q=
                  {job.qualityScore != null
                    ? job.qualityScore.toFixed(2)
                    : "—"}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
