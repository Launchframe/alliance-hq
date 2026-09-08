"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { loadTeamWorkDashboard } from "@/lib/support-teams/work-service.server";
import { CoveragePanel } from "@/components/time-off/CoveragePanel";

type Dashboard = Awaited<ReturnType<typeof loadTeamWorkDashboard>>;

export function TeamWorkClient({ initial }: { initial: Dashboard }) {
  const t = useTranslations("teamWork");
  const support = useTranslations("supportTeams");
  const timeOff = useTranslations("timeOff");
  const vs = useTranslations("vsCompliance");
  const trains = useTranslations("trains.conductorHistory");
  const professions = useTranslations("videoReview.rosterProfession");
  const locale = useLocale();
  const [data, setData] = useState(initial);
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
        const next = await response.json();
        if (!response.ok) throw new Error(next.error ?? support("changed"));
        if (active) { setData(next); setError(null); }
      } catch (cause) { if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : support("changed")); }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [personal, revision, support]);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const teamName = (id: string) => data.teams.find((entry) => entry.id === id)?.name ?? support("defaultName", { number: (data.teams.findIndex((entry) => entry.id === id) + 1).toLocaleString(locale) });
  const items = data.items.filter((item) => (!team || item.teamId === team) && (!kind || item.kind === kind));
  const members = data.members.filter((member) => !team || member.teamId === team);
  return <main className="mx-auto max-w-6xl space-y-6 p-4" data-testid="team-work">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{t("title")}</h1><button type="button" onClick={() => setRevision((value) => value + 1)}>{timeOff("unexpectedReport.refresh")}</button></header>
    {error ? <p role="alert">{error}</p> : null}
    <div className="flex flex-wrap gap-4">
      <label><input type="checkbox" checked={personal} onChange={(event) => setPersonal(event.target.checked)} /> {support("myTeam")}</label>
      <label>{support("teamName")} <select value={team} onChange={(event) => setTeam(event.target.value)} className="rounded border bg-hq-surface p-2"><option value="">{support("title")}</option>{data.teams.map((entry) => <option key={entry.id} value={entry.id}>{teamName(entry.id)}</option>)}</select></label>
      <label>{timeOff("officerModal.kind")} <select value={kind} onChange={(event) => setKind(event.target.value)} className="rounded border bg-hq-surface p-2"><option value="">{t("title")}</option><option value="time_off">{timeOff("workflow.planned")}</option><option value="coverage">{t("reassign")}</option><option value="vs">{vs("title")}</option></select></label>
    </div>
    <section className="grid gap-4 md:grid-cols-2" data-testid="team-work-members">
      {members.map((member) => <article key={member.id} className="space-y-2 rounded border border-hq-border p-4">
        <h2 className="font-semibold">{member.name}</h2>
        {member.own ? member.teamId ? <p>{t("yourTeam", { team: teamName(member.teamId), lead: data.teams.find((entry) => entry.id === member.teamId)?.leadName ?? support("unknown") })}</p> : <p>{support("noTeam")}</p> : null}
        {member.absences.map((absence, index) => <p key={index}>{timeOff(absence.unexpected ? "workflow.unexpected" : "workflow.planned")}: {timeOff("entry.range", { start: date(absence.startDate), end: date(absence.endDate) })}</p>)}
        {member.duties.map((duty, index) => <p key={index}>{duty.role === "engineer" ? professions("engineer") : trains(duty.role)}: {date(duty.date)}</p>)}
        {member.currentWeek ? <div className="space-y-1">
          <p>{date(member.currentWeek.weekEnding)} · {vs(member.currentWeek.evidenceState)} · {member.currentWeek.score?.toLocaleString(locale) ?? support("unknown")} · {member.currentWeek.dailyCoverage.toLocaleString(locale)}/{(6).toLocaleString(locale)}</p>
          {member.currentWeek.days.map((day) => <p key={day.date}>{date(day.date)} · {vs(day.evidenceState)} · {day.score?.toLocaleString(locale) ?? support("unknown")}</p>)}
        </div> : null}
        {member.weeks.map((week) => <p key={week.weekEnding}>{date(week.weekEnding)} · {vs(week.evidenceState)} · {week.dailyCoverage.toLocaleString(locale)}/{(6).toLocaleString(locale)} · {week.outcome === "pending_data" ? vs("missing") : week.outcome === "not_eligible" ? support("unknown") : vs(week.outcome)}</p>)}
        {member.own ? <Link href="/time-off">{timeOff("title")}</Link> : null}
      </article>)}
    </section>
    <section className="space-y-3" data-testid="team-work-items"><h2 className="text-xl font-semibold">{t("digest")}</h2>
      {!items.length ? <p>{t("empty")}</p> : null}
      {items.map((item) => <article key={item.id} className="space-y-2 rounded border border-hq-border p-4">
        <h3 className="font-semibold">{item.detail.memberName} · {date(item.detail.date)}</h3>
        <p>{item.kind === "vs" ? vs("title") : item.kind === "coverage" ? t("reassign") : timeOff(item.detail.unexpected ? "workflow.unexpected" : "workflow.planned")}</p>
        {item.detail.evidenceState ? <p>{vs(item.detail.evidenceState)}</p> : null}
        {item.detail.recommendation?.kind === "demote" ? <p>{vs("demote", { rank: `R${item.detail.recommendation.targetRank?.toLocaleString(locale) ?? ""}` })}</p> : item.detail.recommendation?.kind === "remove" ? <p>{vs("remove")}</p> : item.detail.recommendation?.kind === "leadership_review" ? <p>{vs("leadershipReview")}</p> : null}
        {item.assigneeName ? <p>{t("assignedTo", { name: item.assigneeName })}</p> : null}
        {item.leadAway && item.leadName && item.assigneeName ? <p>{t("leadAway", { lead: item.leadName, fallback: item.assigneeName })}</p> : item.leadUnlinked ? <p>{t("leadUnlinked")}</p> : null}
        <Link href={item.href}>{item.kind === "vs" ? vs("title") : item.kind === "coverage" ? t("reassign") : timeOff("title")}</Link>
      </article>)}
    </section>
    {data.canReview ? <CoveragePanel refreshKey={String(revision)} onResolved={() => setRevision((value) => value + 1)} memberIds={items.filter((item) => item.kind === "coverage").map((item) => item.memberId)} /> : null}
    <section className="space-y-2"><h2 className="text-xl font-semibold">{support("title")}</h2>{data.teams.map((entry) => <p key={entry.id}>{teamName(entry.id)} · {entry.leadName ?? support("leadNeedsReplacement")}</p>)}</section>
  </main>;
}
