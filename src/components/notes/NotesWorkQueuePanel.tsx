"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { filterOfficerWorkQueueItems, workQueueShowsEmpty, type TeamWorkDashboard, type TeamWorkDashboardItem } from "@/lib/support-teams/work-dashboard.shared";
import { CoveragePanel } from "@/components/time-off/CoveragePanel";

type Item = TeamWorkDashboardItem;

function VsWorkCard({ item }: { item: Item }) {
  const t = useTranslations("teamWork");
  const vs = useTranslations("vsCompliance");
  const locale = useLocale();
  const [details, setDetails] = useState(false);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${item.detail.date}T12:00:00Z`));
  return <article className="space-y-2 rounded border border-hq-border p-4">
    <h3 className="font-semibold">{t("vsReviewTitle")}</h3>
    <p>{item.detail.memberName} · {date}</p>
    {item.assigneeName ? <p>{t("assignedTo", { name: item.assigneeName })}</p> : null}
    {item.leadAway && item.leadName && item.assigneeName ? <p>{t("leadAway", { lead: item.leadName, fallback: item.assigneeName })}</p> : item.leadUnlinked ? <p>{t("leadUnlinked")}</p> : null}
    <div className="flex flex-wrap gap-4">
      <Link href={item.href}>{vs("title")}</Link>
      <button type="button" onClick={() => setDetails((value) => !value)}>{details ? t("hideDetails") : t("showDetails")}</button>
    </div>
    {details ? <div className="space-y-1">
      {item.detail.evidenceState ? <p>{vs(item.detail.evidenceState)}</p> : null}
      {item.detail.recommendation?.kind === "demote" ? <p>{vs("demote", { rank: `R${item.detail.recommendation.targetRank?.toLocaleString(locale) ?? ""}` })}</p> : item.detail.recommendation?.kind === "remove" ? <p>{vs("remove")}</p> : item.detail.recommendation?.kind === "leadership_review" ? <p>{vs("leadershipReview")}</p> : null}
      {typeof item.detail.dailyCoverage === "number" ? <p>{item.detail.dailyCoverage.toLocaleString(locale)}/{(6).toLocaleString(locale)}</p> : null}
    </div> : null}
  </article>;
}

export function NotesWorkQueuePanel() {
  const t = useTranslations("teamWork");
  const support = useTranslations("supportTeams");
  const timeOff = useTranslations("timeOff");
  const vs = useTranslations("vsCompliance");
  const locale = useLocale();
  const [data, setData] = useState<TeamWorkDashboard | null>(null);
  const [personal, setPersonal] = useState(true);
  const [team, setTeam] = useState("");
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(`/api/team-work?scope=${personal ? "personal" : "all"}`, { cache: "no-store", signal: controller.signal });
        const next = await response.json().catch(() => null);
        if (!response.ok) throw new Error(next?.error ?? support("changed"));
        if (active) { setData(next); setError(null); }
      } catch (cause) { if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : support("changed")); }
    }
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(() => void refresh(), 30_000);
    return () => { active = false; controller.abort(); clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [personal, revision, support]);
  const teamName = useCallback((id: string) => data?.teams.find((entry) => entry.id === id)?.name ?? support("defaultName", { number: ((data?.teams.findIndex((entry) => entry.id === id) ?? 0) + 1).toLocaleString(locale) }), [data, support, locale]);
  const items = filterOfficerWorkQueueItems(data?.items ?? [], { team, kind });
  const vsItems = items.filter((item) => item.kind === "vs");
  const coverageIds = items.filter((item) => item.kind === "coverage").map((item) => item.memberId);
  if (error && !data) return <section className="min-w-0 flex-1 p-4 sm:p-6" data-testid="team-work"><p role="alert" className="text-sm text-hq-danger">{error}</p></section>;
  return <section className="min-w-0 flex-1 space-y-6 p-4 sm:p-6" data-testid="team-work">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="text-sm text-hq-fg-muted">{t("subtitle")}</p></div>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>{timeOff("unexpectedReport.refresh")}</button>
    </header>
    {error ? <p role="alert">{error}</p> : null}
    <div className="flex flex-wrap gap-4">
      <select aria-label={t("myAssignments")} value={personal ? "personal" : "all"} onChange={(event) => setPersonal(event.target.value === "personal")} className="rounded border bg-hq-surface p-2">
        <option value="personal">{t("myAssignments")}</option>
        <option value="all">{t("allAssignments")}</option>
      </select>
      <select aria-label={support("teamName")} value={team} onChange={(event) => setTeam(event.target.value)} className="rounded border bg-hq-surface p-2">
        <option value="">{t("allTeams")}</option>
        {data?.teams.map((entry) => <option key={entry.id} value={entry.id}>{teamName(entry.id)}</option>)}
      </select>
      <select aria-label={t("allTypes")} value={kind} onChange={(event) => setKind(event.target.value)} className="rounded border bg-hq-surface p-2">
        <option value="">{t("allTypes")}</option>
        <option value="coverage">{t("coverageType")}</option>
        <option value="vs">{vs("title")}</option>
      </select>
    </div>
    {workQueueShowsEmpty(data !== null, items.length) ? <p>{personal ? t("emptyMine") : t("emptyAll")}</p> : null}
    <section className="space-y-3" data-testid="team-work-items">
      {vsItems.map((item) => <VsWorkCard key={item.id} item={item} />)}
    </section>
    {coverageIds.length ? <CoveragePanel heading={t("coverageReviewTitle")} refreshKey={String(revision)} onResolved={() => setRevision((value) => value + 1)} memberIds={coverageIds} /> : null}
  </section>;
}
