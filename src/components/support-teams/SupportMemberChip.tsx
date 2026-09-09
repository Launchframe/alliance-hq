"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
export function SupportMemberChip({ member, display, highlighted, draggable = false, onDrag, onDragEnd, children }: {
  member: SupportRosterMember; display: SupportDisplayPreferences; highlighted?: boolean; draggable?: boolean;
  onDrag?: (id: string) => void; onDragEnd?: () => void; children?: ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("supportTeams");
  const dragFrame = useRef<number | null>(null);
  useEffect(() => () => { if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current); }, []);
  return <article data-support-member={member.id} tabIndex={-1} draggable={draggable}
    onDragStart={(event) => { event.dataTransfer.setData("application/x-support-member", member.id); event.dataTransfer.effectAllowed = "move"; dragFrame.current = requestAnimationFrame(() => { dragFrame.current = null; onDrag?.(member.id); }); }}
    onDragEnd={() => { if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current); dragFrame.current = null; onDragEnd?.(); }}
    className={`rounded-lg border border-hq-border bg-hq-canvas p-3 text-sm focus-visible:ring-2 focus-visible:ring-hq-accent ${highlighted ? "ring-2 ring-hq-accent" : ""} ${draggable ? "cursor-grab" : ""}`}>
    <SupportMemberIdentity member={member} />
    {!member.hqLinked && <p className="text-xs text-hq-fg-muted">{t("unlinked")}</p>}
    <dl className="mt-1 grid grid-cols-2 gap-x-2 text-xs text-hq-fg-muted">
      {chipMetrics.filter((key) => display[key]).map((key) => <div key={key}><dt>{t(metricLabels[key])}</dt><dd>{member[key] === null ? t("unknown") : key === "tenureDays" ? t("tenureDays", { days: member[key].toLocaleString(locale) }) : member[key].toLocaleString(locale)}</dd></div>)}
    </dl>
    {children}
  </article>;
}
