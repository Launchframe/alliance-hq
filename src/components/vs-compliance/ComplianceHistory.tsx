"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { VsComplianceHistory } from "@/lib/vs-compliance/types.shared";
import { ComplianceClientError, isComplianceHistory, readComplianceResponse, RequestVersion, syncLabel, type ComplianceRow } from "./client.shared";

export function ComplianceHistoryRecords({ history }: { history: VsComplianceHistory }) {
  const all = useTranslations();
  const t = useTranslations("vsCompliance");
  const locale = useLocale();
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Etc/GMT+2" }).format(new Date(value));
  const rank = (value: number | null) => value === null ? all("commandersIndex.unreportedShort") : `R${new Intl.NumberFormat(locale).format(value)}`;
  return <div data-testid="compliance-action-history" className="space-y-3">
    <p>{history.memberName}</p>
    <p>{all("timeOff.workflow.serverTime")}</p>
    <ol className="space-y-3">{history.actions.map((action) => <li key={action.id} className="space-y-2 rounded border border-hq-border p-3">
      <p>{t(action.kind === "waive" ? "waived" : "actionSaved")}</p>
      <p><time dateTime={action.recordedAt}>{date(action.recordedAt)}</time> · {action.actorName ?? all("commandersIndex.unreported")}</p>
      {action.kind !== "waive" ? <p>{all("commandersIndex.colInGameRank")}: {rank(action.expectedRank)} → {action.kind === "remove" ? all("members.statusFormer") : rank(action.targetRank)}</p> : null}
      {action.reason !== null ? <dl><dt>{t("waiverReason")}</dt><dd className="whitespace-pre-wrap break-words">{action.reason}</dd></dl> : null}
      {action.correctionReview ? <div><p>{t("changed")}</p>{action.reviewDates.map((value, index) => <p key={`${value}:${index}`}><time dateTime={value}>{date(value)}</time></p>)}</div> : null}
      {action.syncStatus !== null && action.supersededAt === null ? <p>{all("timeOff.sync.title")}: {all(`timeOff.sync.${syncLabel(action.syncStatus)}`)}</p> : null}
      {action.supersededAt !== null ? <p>{t("handled")} <time dateTime={action.supersededAt}>{date(action.supersededAt)}</time></p> : null}
    </li>)}</ol>
    {!history.actions.length ? <p>{all("timeOff.workflow.history")}: {new Intl.NumberFormat(locale).format(0)}</p> : null}
  </div>;
}

export function ComplianceHistory({ row }: { row: ComplianceRow }) {
  const all = useTranslations();
  const [history, setHistory] = useState<VsComplianceHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(new RequestVersion());
  const inFlight = useRef(false);
  useEffect(() => { const version = requests.current; return () => { version.next(); }; }, []);
  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    const version = requests.current.next();
    setLoading(true); setError(null);
    try {
      const payload = await fetch(`/api/vs-compliance?eventId=${encodeURIComponent(row.id)}`, { cache: "no-store" }).then((response) => readComplianceResponse(response, all("statSync.actionFailed")));
      if (!isComplianceHistory(payload) || payload.eventId !== row.id || payload.memberId !== row.memberId || payload.weekEnding !== row.weekEnding) throw new Error(all("statSync.actionFailed"));
      if (requests.current.current(version)) setHistory(payload);
    } catch (failure) {
      if (requests.current.current(version)) { setHistory(null); setError(failure instanceof ComplianceClientError ? failure.message : all("statSync.actionFailed")); }
    } finally {
      inFlight.current = false;
      if (requests.current.current(version)) setLoading(false);
    }
  }
  return <details className="rounded border border-hq-border p-2 text-sm" onToggle={(event) => { if (event.currentTarget.open && !history && !loading && !error) void load(); }}>
    <summary className="cursor-pointer">{all("timeOff.workflow.history")}</summary>
    <div className="mt-3 space-y-3">
      {loading ? <p role="status">{all("common.loading")}</p> : null}
      {error ? <p role="alert" className="text-hq-danger">{error}</p> : null}
      {history ? <ComplianceHistoryRecords history={history} /> : null}
      <button type="button" disabled={loading} className="rounded border border-hq-border px-3 py-2 disabled:opacity-50" onClick={() => void load()}>{all("timeOff.unexpectedReport.refresh")}</button>
    </div>
  </details>;
}
