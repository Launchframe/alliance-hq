"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ComplianceRow } from "./client.shared";

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
