"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { expandPlan, parsePlanSchedule, PlanScheduleError, type PlanSchedule } from "@/lib/plunder-plan/schedule.shared";
import type { PlanSummary } from "@/lib/plunder-plan/types.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

const inputClass = "w-full rounded border border-hq-border bg-hq-canvas p-2 text-hq-fg";
export function PlunderPlanEditor({ initial, commanders, suggestion, source, zone, date, busy, discordLinked, onSave }: {
  initial?: PlanSummary; commanders: { id: string; name: string }[]; suggestion: boolean; source?: PlanSummary;
  zone: string; date: string; busy: boolean; discordLinked: boolean; onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("plunderPlan");
  const locale = useLocale();
  const [schedule, setSchedule] = useState<PlanSchedule>(() => initial?.schedule ?? source?.schedule ?? { kind: "weekly", date, zone, start: "20:00", end: "21:00", endsNextDay: false, days: [new Date(`${date}T12:00:00Z`).getUTCDay()] });
  const [memberId, setMemberId] = useState(initial?.memberId ?? commanders[0]?.id ?? "");
  const [reminder, setReminder] = useState(initial?.reminder ?? false);
  const preview = useMemo(() => {
    try {
      const parsed = parsePlanSchedule(schedule);
      const from = new Date(`${schedule.date}T00:00:00Z`);
      return { ...expandPlan(parsed, from.toISOString(), new Date(from.getTime() + 8 * 86_400_000).toISOString()), error: null };
    } catch (error) { return { occurrences: [], skippedDates: [], error: error instanceof PlanScheduleError ? error.code : "invalidSchedule" as const }; }
  }, [schedule]);
  const patch = (update: Partial<PlanSchedule>) => setSchedule((current) => ({ ...current, ...update }));
  const format = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: schedule.zone }).format(new Date(iso));
  return <form className="space-y-4" onSubmit={async (event) => {
    preventDefaultFormSubmit(event);
    if (preview.error) return;
    await onSave(initial ? { action: "edit", id: initial.id, expectedVersion: initial.version, schedule, reminder } : { action: "create", kind: suggestion ? "suggestion" : "plan", ...(suggestion ? {} : { memberId }), ...(source ? { sourceId: source.id, sourceVersion: source.version } : {}), schedule, reminder: !suggestion && reminder });
  }}>
    {!suggestion && <label className="block">{t("commander")}<select aria-label={t("commander")} className={inputClass} value={memberId} disabled={!!initial || busy} onChange={(e) => setMemberId(e.target.value)} required>{commanders.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
    <label className="block">{t("scheduleType")}<select aria-label={t("scheduleType")} className={inputClass} value={schedule.kind} disabled={busy} onChange={(e) => patch({ kind: e.target.value as PlanSchedule["kind"] })}><option value="weekly">{t("weekly")}</option><option value="once">{t("once")}</option></select></label>
    <label className="block">{t(schedule.kind === "once" ? "date" : "startsOn")}<input type="date" className={inputClass} value={schedule.date} disabled={busy} onChange={(e) => patch({ date: e.target.value })} required /></label>
    {schedule.kind === "weekly" && <fieldset><legend>{t("weekdays")}</legend><div className="flex flex-wrap gap-3">{Array.from({ length: 7 }, (_, dow) => <label className="flex min-h-11 items-center gap-1" key={dow}><input type="checkbox" disabled={busy} checked={schedule.days.includes(dow)} onChange={(e) => patch({ days: e.target.checked ? [...schedule.days, dow] : schedule.days.filter((day) => day !== dow) })} />{new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + dow)))}</label>)}</div></fieldset>}
    <div className="grid grid-cols-2 gap-3"><label>{t("startTime")}<input type="time" className={inputClass} value={schedule.start} disabled={busy} onChange={(e) => patch({ start: e.target.value })} required /></label><label>{t("endTime")}<input type="time" className={inputClass} value={schedule.end} disabled={busy} onChange={(e) => patch({ end: e.target.value })} required /></label></div>
    <label className="flex items-center gap-2"><input type="checkbox" checked={schedule.endsNextDay} disabled={busy} onChange={(e) => patch({ endsNextDay: e.target.checked })} />{t("endsNextDay")}</label>
    <label className="block">{t("timeZone")}<input aria-label={t("timeZone")} className={inputClass} value={schedule.zone} list="plunder-plan-zones" disabled={busy} onChange={(e) => patch({ zone: e.target.value })} required /><datalist id="plunder-plan-zones"><option value={zone}>{t("localTime")}</option><option value="Etc/GMT+2">{t("serverTime")}</option></datalist></label>
    <p className="text-sm text-hq-fg-muted">{t("zoneHint")}</p>
    <p className="text-sm text-hq-fg-muted">{t("dstHint")}</p>
    {!suggestion && <label className="block"><input type="checkbox" checked={reminder} disabled={busy} onChange={(e) => setReminder(e.target.checked)} /> {t("notifications.private")}<span className="block text-sm text-hq-fg-muted">{t("notifications.privateHint")}</span></label>}
    {!suggestion && reminder && !discordLinked && <p>{t("notifications.linkMissing")}</p>}
    <section aria-label={t("preview")}><h3 className="font-semibold">{t("preview")}</h3>{preview.error ? <p role="alert">{t(`errors.${preview.error}`)}</p> : <ul className="text-sm">{preview.occurrences.slice(0, 8).map((occurrence) => <li key={occurrence.key}>{format(occurrence.startAt)} – {format(occurrence.endAt)}</li>)}</ul>}{preview.skippedDates.map((day) => <p key={day}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}: {t("dstSkipped")}</p>)}</section>
    <p className="text-sm">{t(suggestion ? "suggestionIndependent" : "visibility")}</p>
    <button className="min-h-11 rounded bg-hq-accent px-4 text-hq-canvas disabled:opacity-50" disabled={busy || !!preview.error || (!suggestion && !memberId)}>{t("save")}</button>
  </form>;
}
