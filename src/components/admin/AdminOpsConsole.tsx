"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";

type OpsSummary = {
  health: {
    ok?: boolean;
    db?: boolean;
    schema?: boolean;
    httpStatus?: number;
    sha?: string | null;
    ts?: string;
  };
  recentFailures: OpsEventRow[];
  latestCronRuns: CronRunRow[];
};

type OpsEventRow = {
  id: string;
  severity: string;
  source: string;
  title: string;
  body: string;
  fingerprint: string | null;
  sentryEventId: string | null;
  createdAt: string;
};

type CronRunRow = {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorClass: string | null;
  errorMessage: string | null;
  processed: number | null;
};

export function AdminOpsConsole() {
  const t = useTranslations("admin.opsPage");
  const formatDateTime = useFormatAccountDateTime();
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [events, setEvents] = useState<OpsEventRow[]>([]);
  const [severityFilter, setSeverityFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(() => {
    void (async () => {
      try {
        const summaryRes = await fetch("/api/admin/ops/summary");
        if (!summaryRes.ok) throw new Error(await summaryRes.text());
        setSummary((await summaryRes.json()) as OpsSummary);

        const q = severityFilter
          ? `?severity=${encodeURIComponent(severityFilter)}`
          : "";
        const eventsRes = await fetch(`/api/admin/ops/events${q}`);
        if (!eventsRes.ok) throw new Error(await eventsRes.text());
        setEvents((await eventsRes.json()) as OpsEventRow[]);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    })();
  }, [severityFilter, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendTestAlert() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/ops/test-alert", { method: "POST" });
      if (!res.ok) {
        setTestResult(t("testAlertError"));
        return;
      }
      setTestResult(t("testAlertSuccess"));
      load();
    } catch {
      setTestResult(t("testAlertError"));
    } finally {
      setTestLoading(false);
    }
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!summary) {
    return <p className="text-sm text-hq-fg-muted">{t("loading")}</p>;
  }

  const healthOk = summary.health?.ok === true;
  const healthLabel = healthOk
    ? t("healthOk")
    : summary.health?.httpStatus
      ? t("healthDegraded")
      : t("healthUnavailable");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          disabled={testLoading}
          onClick={() => void sendTestAlert()}
          className="rounded-lg border border-hq-border bg-hq-surface px-4 py-2 text-sm font-medium hover:bg-hq-surface-muted disabled:opacity-50"
        >
          {testLoading ? t("testAlertSending") : t("testAlert")}
        </button>
      </div>
      {testResult ? (
        <p className="text-sm text-hq-fg-muted">{testResult}</p>
      ) : null}

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("healthHeading")}</h2>
        <p
          className={`mt-2 text-sm ${healthOk ? "text-hq-green" : "text-red-400"}`}
        >
          {healthLabel}
        </p>
        {summary.health.sha ? (
          <p className="mt-1 font-mono text-xs text-hq-fg-muted">
            {summary.health.sha.slice(0, 7)}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">{t("eventsHeading")}</h2>
          <label className="text-xs text-hq-fg-muted">
            {t("eventsSeverity")}{" "}
            <select
              className="ml-1 rounded border border-hq-border bg-hq-canvas px-2 py-1 text-sm text-hq-fg"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              <option value="">{t("filterAll")}</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
              <option value="page">page</option>
            </select>
          </label>
        </div>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-hq-fg-muted">{t("eventsEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-hq-border">
            {events.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    [{event.severity}] {event.title}
                  </span>
                  <span className="text-xs text-hq-fg-muted">
                    {formatDateTime(event.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-hq-fg-muted">
                  {t("eventsSource")}: {event.source}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-hq-fg-muted">
                  {event.body}
                </p>
                {event.sentryEventId ? (
                  <a
                    className="mt-1 inline-block text-xs text-hq-link underline"
                    href={`https://sentry.io/issues/?query=${encodeURIComponent(event.sentryEventId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("openInSentry")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("cronHeading")}</h2>
        {summary.latestCronRuns.length === 0 ? (
          <p className="mt-3 text-sm text-hq-fg-muted">{t("cronEmpty")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-hq-fg-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t("cronName")}</th>
                  <th className="py-2 pr-3 font-medium">{t("cronStatus")}</th>
                  <th className="py-2 pr-3 font-medium">{t("cronDuration")}</th>
                  <th className="py-2 font-medium">{t("cronWhen")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.latestCronRuns.map((run) => (
                  <tr key={run.id} className="border-t border-hq-border">
                    <td className="py-2 pr-3 font-mono text-xs">{run.name}</td>
                    <td className="py-2 pr-3">{run.status}</td>
                    <td className="py-2 pr-3">
                      {run.durationMs != null ? `${run.durationMs}ms` : "—"}
                    </td>
                    <td className="py-2 text-xs text-hq-fg-muted">
                      {formatDateTime(run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
