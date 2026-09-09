"use client";

import { useLocale, useTranslations } from "next-intl";
import type { SupportRosterMember } from "@/lib/support-teams/types.shared";
import type { SupportDisplayPreferences } from "@/lib/support-teams/display-preferences.shared";
import { chipMetrics, countryPresentation, metricLabels } from "@/lib/support-teams/board-client.shared";

export function SupportMemberIdentity({ member }: { member: SupportRosterMember }) {
  const locale = useLocale();
  const t = useTranslations("supportTeams");
  const country = countryPresentation(member.country, locale, t("unknown"));
  return <span className="inline-flex items-center gap-2"><span role="img" aria-label={`${t("country")}: ${country.label}`}>{country.flag}</span><span>{member.name}</span></span>;
}
export function SupportMemberDetails({ member, display }: { member: SupportRosterMember; display: SupportDisplayPreferences }) {
  const locale = useLocale();
  const t = useTranslations("supportTeams");
  return <>
    <SupportMemberIdentity member={member} />
    {!member.hqLinked && <p className="text-xs text-hq-fg-muted">{t("unlinked")}</p>}
    <dl className="mt-1 grid grid-cols-2 gap-x-2 text-xs text-hq-fg-muted">
      {chipMetrics.filter((key) => display[key]).map((key) => <div key={key}><dt>{t(metricLabels[key])}</dt><dd>{member[key] === null ? t("unknown") : key === "tenureDays" ? t("tenureDays", { days: member[key].toLocaleString(locale) }) : member[key].toLocaleString(locale)}</dd></div>)}
    </dl>
  </>;
}
