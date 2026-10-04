"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { addCalendarDays } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { policyForVsWeek } from "@/lib/vs-compliance/policy.shared";
import { ComplianceDailyEvidence, ComplianceEvidence } from "./ComplianceEvidence";
import { ComplianceHistory } from "./ComplianceHistory";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { ComplianceClientError, isDashboard, isMembershipSettings, readComplianceResponse, RequestVersion, syncLabel, type ComplianceDashboard, type ComplianceRow, type MembershipSettings } from "./client.shared";

const buttonClass = "rounded border border-hq-border px-3 py-2 text-sm disabled:opacity-50";

export function ComplianceDashboardClient({ initialWeek, lastClosedWeek, allianceTag, highlightEventId = null }: { initialWeek: string; lastClosedWeek: string; allianceTag: string; highlightEventId?: string | null }) {
  const t = useTranslations("vsCompliance");
  const all = useTranslations();
  const locale = useLocale();
  const [week, setWeek] = useState(initialWeek);
  const [data, setData] = useState<ComplianceDashboard | null>(null);
  const [settings, setSettings] = useState<MembershipSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<{ row: ComplianceRow; operation: "complete" | "waive" } | null>(null);
  const requests = useRef(new RequestVersion());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const highlightRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  useEffect(() => {
    if (loading || !highlightEventId || !highlightRef.current) return;
    const node = highlightRef.current;
    const frame = window.requestAnimationFrame(() => {
      node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, highlightEventId, week, data?.weekEnding]);
  const load = useCallback(async (selectedWeek: string) => {
    const version = requests.current.next();
    setLoading(true);
    setError(null);
    try {
      const [payload, policy] = await Promise.all([
        fetch(`/api/vs-compliance?weekEnding=${encodeURIComponent(selectedWeek)}`, { cache: "no-store" }).then((response) => readComplianceResponse(response, all("statSync.actionFailed"))),
        fetch(`/api/alliance/${encodeURIComponent(allianceTag)}/vs-membership-minimums`, { cache: "no-store" }).then((response) => readComplianceResponse(response, all("statSync.actionFailed"))),
      ]);
      if (!isDashboard(payload) || payload.weekEnding !== selectedWeek || !isMembershipSettings(policy)) throw new Error(all("statSync.actionFailed"));
      if (requests.current.current(version)) { setData(payload); setSettings(policy); }
    } catch (failure) {
      if (requests.current.current(version)) { setError(failure instanceof ComplianceClientError ? failure.message : all("statSync.actionFailed")); setData(null); }
    } finally { if (requests.current.current(version)) setLoading(false); }
  }, [all, allianceTag]);
  useEffect(() => {
    const version = requests.current;
    const timer = window.setTimeout(() => { void load(week); }, 0);
    return () => { window.clearTimeout(timer); version.next(); };
  }, [load, week]);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const visible = data?.weekEnding === week ? data : null;
  const policy = settings ? policyForVsWeek(settings.history, week) ?? settings.defaults : null;
  const number = (value: number | null) => value === null ? all("commandersIndex.unreportedShort") : new Intl.NumberFormat(locale).format(value);
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-hq-fg-muted">{t("manualHint")}</p>
      <p className="text-sm text-hq-fg-muted">{t("dailyHint")}</p>
      <p className="text-sm text-hq-fg-muted">{t("resetHint")}</p>
      <div className="flex flex-wrap gap-4"><Link className="text-hq-accent underline" href="/settings/vs-membership-minimums">{t("settings")}</Link><Link className="text-hq-accent underline" href="/time-off">{all("timeOff.title")}</Link></div>
    </header>
    <section className="space-y-3" aria-label={t("title")}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} disabled={loading || !!selection} onClick={() => setWeek(addCalendarDays(week, -7))}>{all("timeOff.workflow.previous")}</button>
        <label className="space-y-1 text-sm"><span className="block">{all("timeOff.workflow.history")}</span><input aria-label={all("timeOff.workflow.history")} type="date" value={week} max={lastClosedWeek} step={7} disabled={loading || !!selection} onChange={(event) => { if (validateVsPeriod(event.target.value, "weekly") && event.target.value <= lastClosedWeek) setWeek(event.target.value); }} className="rounded border border-hq-border bg-hq-surface p-2" /></label>
        <button type="button" className={buttonClass} disabled={loading || !!selection || week >= lastClosedWeek} onClick={() => setWeek(addCalendarDays(week, 7))}>{all("timeOff.workflow.next")}</button>
        <button type="button" className={buttonClass} disabled={loading || !!selection} onClick={() => void load(week)}>{all("timeOff.unexpectedReport.refresh")}</button>
      </div>
      <p className="text-sm">{all("videoReview.vsWeeklyDateOption", { date: date(week) })}</p>
      {visible && policy ? <div className="grid gap-3 rounded-xl border border-hq-border bg-hq-surface p-4 sm:grid-cols-2">
        <p>{t("dailyTarget")}: {number(policy.dailyTarget)}</p>
        <p>{t("weeklyMinimum")}: {number(policy.weeklyMinimum)}</p>
        <p>{t("leeway")}: {number(policy.leewayPct)}</p>
        <p>{t("preset")}: {t(policy.preset === "rank_aware" ? "rankAware" : "consecutive")}</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={policy.enabled} disabled readOnly />{t("enabled")}</label>
      </div> : null}
      {error ? <p ref={errorRef} role="alert" className="text-hq-danger">{error}</p> : null}
      {loading ? <p role="status">{all("common.loading")}</p> : null}
      {!loading && visible?.rows.length === 0 ? <p>{t("empty")}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">{visible?.rows.map((row) => {
        const highlighted = highlightEventId === row.id;
        return <article
          key={row.id}
          ref={highlighted ? highlightRef : undefined}
          data-testid="compliance-row"
          data-highlighted={highlighted ? "true" : undefined}
          className={`space-y-3 rounded-xl border bg-hq-surface p-4 ${highlighted ? "border-hq-accent ring-2 ring-hq-accent/40" : "border-hq-border"}`}
        >
        <h2 className="font-semibold">{row.memberName}</h2>
        <ComplianceEvidence row={row} />
        <ComplianceDailyEvidence row={row} />
        <ComplianceHistory key={`${row.id}:${row.confirmationBasis}`} row={row} />
        <p className="text-sm" role="status">{all(`timeOff.sync.${syncLabel(row.syncStatus)}`)}</p>
        {["credentials_required", "failed"].includes(row.syncStatus) ? <Link href="/connect?next=/vs-compliance" className="text-sm text-hq-accent underline">{all("common.connect")}</Link> : null}
        {visible.canManage && !loading ? <div className="flex flex-wrap gap-2">
          {!row.settled && ["demote", "remove"].includes(row.recommendation.kind) ? <button type="button" className={buttonClass} onClick={() => setSelection({ row: structuredClone(row), operation: "complete" })}>{t("confirm")}</button> : null}
          {row.outcome !== "waived" && (["missed", "pending_data"].includes(row.outcome) || row.settled) ? <button type="button" className={buttonClass} onClick={() => setSelection({ row: structuredClone(row), operation: "waive" })}>{t("waive")}</button> : null}
        </div> : null}
      </article>;
      })}</div>
    </section>
    {selection ? <ConfirmationDialog row={selection.row} operation={selection.operation} onSaved={() => { void load(week); }} onClose={() => { setSelection(null); void load(week); }} /> : null}
  </div>;
}
