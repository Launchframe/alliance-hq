"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Minus } from "lucide-react";
import type { ComplianceRow } from "./client.shared";

export function ComplianceDailyEvidence({ row }: { row: ComplianceRow }) {
  const t = useTranslations("vsCompliance");
  const all = useTranslations();
  const locale = useLocale();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  return <div className="overflow-x-auto">
    <table data-testid="compliance-daily-grid" className="w-full border-collapse text-left text-sm">
      <caption className="pb-2 text-left">{t("dailyTarget")}: {number(row.dailyTarget)}</caption>
      <thead><tr><th scope="col" className="p-2">{all("timeOff.workflow.serverTime")}</th><th scope="col" className="p-2">{all("videoReview.colScore")} / {t("dailyTarget")}</th><th scope="col" className="p-2">{all("members.colStatus")}</th></tr></thead>
      <tbody>{row.daily.map((day) => <tr key={day.date} className="border-t border-hq-border">
        <th scope="row" className="p-2 font-normal"><time dateTime={day.date}>{date(day.date)}</time></th>
        <td className="p-2 tabular-nums"><span className="inline-flex items-center gap-1">{day.score === null ? all("commandersIndex.unreportedShort") : number(day.score)} / {number(row.dailyTarget)}{day.score !== null ? day.score >= row.dailyTarget ? <Check aria-hidden className="size-4" /> : <Minus aria-hidden className="size-4" /> : null}</span></td>
        <td className="space-y-1 p-2"><p>{t(day.state)}</p>
          {day.away ? <p>{all("timeOff.workflow.globalAbsence")}</p> : null}
          {day.excused ? <p>{all("timeOff.workflow.weeklyExcusal")}</p> : null}
          {day.pendingExcusal ? <p>{all("timeOff.sync.noticeUnverified")}</p> : null}
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function ComplianceEvidence({ row }: { row: ComplianceRow }) {
  const t = useTranslations("vsCompliance");
  const all = useTranslations();
  const locale = useLocale();
  const number = (value: number | null) => value === null ? all("commandersIndex.unreportedShort") : new Intl.NumberFormat(locale).format(value);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${row.weekEnding}T12:00:00Z`));
  const rank = row.currentRank === null ? all("commandersIndex.unreported") : `R${number(row.currentRank)}`;
  return <div className="space-y-2 text-sm">
    <p>{all("commandersIndex.colInGameRank")}: {rank}</p>
    <p>{t("weekSummary", { date, score: number(row.score), minimum: number(row.threshold) })}</p>
    <p>{t(row.evidenceState)}</p>
    {row.outcome === "pending_data" ? <p>{t("pendingHint")}</p> : row.outcome !== "not_eligible" ? <p className="font-medium">{t(row.outcome)}</p> : <p>{all("trains.paintRuleGate.ineligibleLocked", { name: row.memberName, rule: t("weeklyMinimum") })}</p>}
    {row.streak !== null ? <p>{t("streak", { count: number(row.streak) })}</p> : null}
    {row.recommendation.kind === "demote" ? <p className="font-semibold">{t("demote", { rank: `R${number(row.recommendation.targetRank)}` })}</p> : row.recommendation.kind === "remove" ? <p className="font-semibold">{t("remove")}</p> : row.recommendation.kind === "leadership_review" ? <><p>{t("leadershipReview")}</p><p>{t("r5Hint")}</p></> : null}
    {row.settled ? <p>{t("actionSaved")}{row.settled.targetRank !== null ? ` · R${number(row.settled.targetRank)}` : null}</p> : null}
    {row.correctionReview ? <p className="text-hq-danger">{t("changed")}</p> : null}
    <details className="break-words rounded border border-hq-border p-2">
      <summary className="cursor-pointer">{all("dashboard.details")}</summary>
      <dl className="mt-2 space-y-2">
        <dt>{t("settings")}</dt><dd>{row.policyVersion === null ? all("commandersIndex.unreportedShort") : all("shell.version", { version: number(row.policyVersion) })}</dd>
        <dt>{t(row.evidenceState)}</dt><dd className="break-all font-mono text-xs">{row.evaluationBasis}</dd>
        <dt>{t("confirm")}</dt><dd className="break-all font-mono text-xs">{row.confirmationBasis}</dd>
      </dl>
    </details>
  </div>;
}
