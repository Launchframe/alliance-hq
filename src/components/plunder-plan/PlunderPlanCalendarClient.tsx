"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addCalendarDays, getWeekStartMonday } from "@/lib/trains/game-time";
import { calendarDayBounds, calendarGroups, calendarSegments, swipeDayDelta } from "@/lib/plunder-plan/calendar-layout.shared";
import { isPlanZone, planClock } from "@/lib/plunder-plan/schedule.shared";
import { parsePlanColor, PLAN_PALETTE, planColorStyle, type PlanColorName } from "@/lib/plunder-plan/colors.shared";
import type { CalendarPlan, PlanDashboard, PlanErrorCode, PlanSummary } from "@/lib/plunder-plan/types.shared";
import { PlunderPlanEditor } from "./PlunderPlanEditor";

const button = "min-h-11 rounded border border-hq-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-hq-accent disabled:opacity-50";
type Modal = { kind: "edit"; plan?: PlanSummary; suggestion?: boolean; source?: PlanSummary } | { kind: "event"; event: CalendarPlan } | { kind: "list"; date: string } | { kind: "color" } | { kind: "remove"; plan: PlanSummary };

function subscribeLayout(callback: () => void) {
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", callback); window.addEventListener("storage", callback); window.addEventListener("plunder-plan-view", callback);
  return () => { media.removeEventListener("change", callback); window.removeEventListener("storage", callback); window.removeEventListener("plunder-plan-view", callback); };
}
function layoutSnapshot() {
  const narrow = window.matchMedia("(max-width: 767px)").matches;
  let view: string | null = null;
  try { view = localStorage.getItem(`plunder-plan-view:${narrow ? "narrow" : "wide"}`); } catch {}
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${narrow ? "narrow" : "wide"}|${view === "day" || view === "week" ? view : narrow ? "day" : "week"}|${isPlanZone(zone) ? zone : "UTC"}`;
}

export function PlunderPlanCalendarClient({ initial, initialDate }: { initial: PlanDashboard; initialDate: string }) {
  const t = useTranslations("plunderPlan"), locale = useLocale();
  const [width, savedView, localZone] = useSyncExternalStore(subscribeLayout, layoutSnapshot, () => "wide|week|Etc/GMT+2").split("|");
  const narrow = width === "narrow", view = savedView === "day" ? "day" : "week";
  const [data, setData] = useState(initial), [date, setDate] = useState(initialDate), [zoneOverride, setZone] = useState<string | null>(null);
  const zone = zoneOverride ?? localZone;
  const [modal, setModal] = useState<Modal | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState<PlanErrorCode | null>(null), [notice, setNotice] = useState<string | null>(null), [color, setColor] = useState(initial.color);
  const floor = useRef(initial.version), generation = useRef(0), request = useRef<AbortController | null>(null), dialog = useRef<HTMLDialogElement>(null);
  const retries = useRef<{ body: string; id: string } | null>(null), touch = useRef<{ x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null), scrollInitialized = useRef(false);
  const weekStart = getWeekStartMonday(date), days = Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i));
  const shownDates = view === "day" ? [date] : days;
  const dateLabel = useCallback((day: string, weekday = false) => new Intl.DateTimeFormat(locale, { ...(weekday ? { weekday: "short" as const, day: "numeric" as const } : { dateStyle: "medium" as const }), timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)), [locale]);
  const timeLabel = (instant: string | number) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(instant));
  const from = `${addCalendarDays(weekStart, -2)}T00:00:00Z`, until = `${addCalendarDays(weekStart, 10)}T00:00:00Z`;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/plunder-plan?${new URLSearchParams({ from, until })}`, { signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setData((old) => ({ ...old, plans: [], occurrences: [], commanders: [], canSuggest: false }));
        throw new Error("load");
      }
      const next = await response.json() as PlanDashboard;
      if (!controller.signal.aborted && generation.current === current && next.version >= floor.current) { floor.current = next.version; setData(next); }
    } catch { if (!controller.signal.aborted && generation.current === current) setError("load"); }
    finally { if (generation.current === current) setLoading(false); }
  }, [from, until]);
  useEffect(() => {
    const initialLoad = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 30_000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { clearTimeout(initialLoad); clearInterval(timer); window.removeEventListener("focus", focus); request.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    if (modal) dialog.current?.showModal(); else dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    if (scrollInitialized.current || !scroller.current) return;
    const bounds = calendarDayBounds(date, zone);
    if (!bounds) return;
    const today = planClock(Date.now(), zone).date;
    const first = data.occurrences.filter((event) => planClock(event.startAt, zone).date === date).sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    const instant = date === today ? Date.now() : first ? Date.parse(first.startAt) : bounds.start;
    scroller.current.scrollTop = Math.max(0, (instant - bounds.start) / 60_000 - 60);
    scrollInitialized.current = true;
  }, [date, zone, data]);
  const changeView = (next: "day" | "week") => { try { localStorage.setItem(`plunder-plan-view:${narrow ? "narrow" : "wide"}`, next); window.dispatchEvent(new Event("plunder-plan-view")); } catch {} };
  const save = async (command: Record<string, unknown>, success: string) => {
    if (busy) return;
    const body = JSON.stringify(command);
    if (retries.current?.body !== body) retries.current = { body, id: crypto.randomUUID() };
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/plunder-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, requestId: retries.current.id }) });
      const result = await response.json() as { version?: number; code?: PlanErrorCode };
      if (!response.ok) { setError(result.code ?? "save"); if (result.code === "stale") await refresh(); return; }
      floor.current = Math.max(floor.current, result.version ?? 0);
      retries.current = null; setNotice(success); setModal(null); await refresh();
    } catch { setError("save"); } finally { setBusy(false); }
  };
  const open = (next: Modal) => { setError(null); retries.current = null; setModal(next); };
  const eventTitle = (event: CalendarPlan) => `${event.kind === "suggestion" ? t("suggestionLabel") : event.memberName}: ${timeLabel(event.startAt)}–${timeLabel(event.endAt)}`;
  const eventList = (day: string) => calendarSegments(data.occurrences, day, zone).map(({ event }) => <li key={event.id}><button className={`${button} w-full text-left`} style={event.kind === "plan" ? planColorStyle(event.color) : undefined} onClick={() => open({ kind: "event", event })}>{eventTitle(event)}</button></li>);
  const ownPlans = data.plans.filter((plan) => plan.owned && plan.kind === "plan");
  const selectedPlan = modal?.kind === "event" ? data.plans.find((plan) => plan.id === modal.event.planId) : undefined;
  return <main className="mx-auto max-w-7xl space-y-5 p-3 text-hq-fg sm:p-6">
    <header><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-2 max-w-3xl text-hq-fg-muted">{t("intro")}</p></header>
    {!modal && error && <p role="alert">{t(`errors.${error}`)}</p>}{notice && <p role="status">{notice}</p>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={!data.commanders.length} onClick={() => open({ kind: "edit" })}>{t("add")}</button><button className={button} onClick={() => { setColor(data.color); open({ kind: "color" }); }}>{t("color.title")}</button>{data.canSuggest && <button className={button} onClick={() => open({ kind: "edit", suggestion: true })}>{t("suggest")}</button>}</div>
    <nav aria-label={t("calendar")} className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-2"><button className={button} aria-label={t(view === "day" ? "previousDay" : "previousWeek")} onClick={() => setDate(addCalendarDays(date, view === "day" ? -1 : -7))}>‹</button><button className={button} onClick={() => setDate(planClock(Date.now(), zone).date)}>{t("today")}</button><button className={button} aria-label={t(view === "day" ? "nextDay" : "nextWeek")} onClick={() => setDate(addCalendarDays(date, view === "day" ? 1 : 7))}>›</button></div>
      <span>{view === "day" ? dateLabel(date) : `${dateLabel(weekStart)} – ${dateLabel(days[6])}`}</span>
      <div className="flex gap-1">{(["day", "week"] as const).map((choice) => <button key={choice} aria-pressed={view === choice} className={button} onClick={() => changeView(choice)}>{t(choice)}</button>)}</div>
      <label>{t("timeZone")} <select className="rounded border border-hq-border bg-hq-canvas p-2" value={zone} onChange={(event) => setZone(event.target.value)}><option value={typeof window === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone}>{t("localTime")}</option><option value="Etc/GMT+2">{t("serverTime")}</option></select></label>
    </nav>
    <div className="grid grid-cols-7 gap-1" aria-label={t("week")}>{days.map((day) => <button key={day} className={`${button} px-1 ${day === date ? "ring-2 ring-hq-accent" : ""}`} onClick={() => { setDate(day); if (narrow) changeView("day"); }}>{dateLabel(day, true)}</button>)}</div>
    {loading && <p role="status">{t("loading")}</p>}
    <div ref={scroller} className="max-h-[65vh] overflow-y-auto rounded border border-hq-border" style={{ touchAction: "pan-y" }} onTouchStart={(event) => { if (view !== "day" || event.touches.length !== 1 || (event.target as HTMLElement).closest("button,input,select")) return; touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }} onTouchCancel={() => { touch.current = null; }} onTouchEnd={(event) => { if (touch.current && event.changedTouches[0]) { const delta = swipeDayDelta(touch.current, { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }); if (delta) setDate((current) => addCalendarDays(current, delta)); } touch.current = null; }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${shownDates.length}, minmax(0, 1fr))` }}>{shownDates.map((day) => {
        const bounds = calendarDayBounds(day, zone), groups = calendarGroups(calendarSegments(data.occurrences, day, zone), narrow && view === "week" ? 1 : 3);
        return <section key={day} aria-label={dateLabel(day)} className="relative border-r border-hq-border" style={{ height: bounds?.minutes ?? 1440 }}>
          {bounds && Array.from({ length: Math.ceil(bounds.minutes / 60) }, (_, hour) => <div key={hour} className="absolute w-full border-t border-hq-border/40 text-[11px] text-hq-fg-muted" style={{ top: hour * 60 }}>{timeLabel(bounds.start + hour * 3_600_000)}</div>)}
          {groups.map((group, index) => <div key={index}>
            {group.visible.map(({ event, lane, startMinute, endMinute }) => <button key={event.id} className={`absolute overflow-hidden rounded border p-1 text-left text-xs focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-hq-accent ${event.kind === "suggestion" ? "border-dashed bg-hq-panel" : ""}`} style={{ ...(event.kind === "plan" ? planColorStyle(event.color) : {}), top: startMinute, height: Math.max(24, endMinute - startMinute), left: `${lane * 100 / (group.lanes + (group.overflow.length ? 1 : 0))}%`, width: `${100 / (group.lanes + (group.overflow.length ? 1 : 0))}%` }} aria-label={eventTitle(event)} onClick={() => open({ kind: "event", event })}>{narrow && view === "week" ? timeLabel(event.startAt) : eventTitle(event)}</button>)}
            {group.overflow.length > 0 && <button className={`${button} absolute right-0 z-10 bg-hq-canvas px-1`} style={{ top: group.startMinute, width: `${100 / (group.lanes + 1)}%` }} onClick={() => open({ kind: "list", date: day })}>{t("morePlans", { count: group.overflow.length })}</button>}
          </div>)}
        </section>;
      })}</div>
    </div>
    <section><h2 className="font-semibold">{t("dayList", { date: dateLabel(date) })}</h2><ul className="space-y-2">{eventList(date)}</ul>{!calendarSegments(data.occurrences, date, zone).length && !loading && <p>{t("empty")}</p>}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">{t("myPlans")}</h2>{!ownPlans.length && <p>{t("emptyOwn")}</p>}{ownPlans.map((plan) => <article key={plan.id} className="space-y-2 rounded border border-hq-border p-3"><strong>{plan.memberName}</strong><p>{plan.schedule.start}–{plan.schedule.end} · {plan.schedule.zone} · {t(plan.schedule.kind === "once" ? "once" : "weekly")}{!plan.active && ` · ${t("pausedLabel")}`}</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => open({ kind: "edit", plan })}>{t("edit")}</button>{plan.schedule.kind === "weekly" && <button className={button} disabled={busy} onClick={() => void save({ action: plan.active ? "pause" : "resume", id: plan.id, expectedVersion: plan.version }, t(plan.active ? "paused" : "resumed"))}>{t(plan.active ? "pause" : "resume")}</button>}<button className={button} disabled={busy} onClick={() => open({ kind: "remove", plan })}>{t("remove")}</button></div>{data.suppressed.filter((row) => row.planId === plan.id).map((row) => <p key={`${row.date}:${row.reason}`}>{dateLabel(row.date)}: {t(row.reason)} {row.reason === "skippedLabel" && <button className={button} disabled={busy} onClick={() => void save({ action: "restore", id: plan.id, expectedVersion: plan.version, date: row.date }, t("restored"))}>{t("restoreOccurrence")}</button>}</p>)}</article>)}</section>
    <dialog ref={dialog} aria-label={t("title")} className="max-h-[90vh] w-[min(95vw,38rem)] overflow-auto rounded-xl border border-hq-border bg-hq-canvas p-5 text-hq-fg backdrop:bg-black/60" onCancel={(event) => { if (busy) event.preventDefault(); else setModal(null); }}>
      <button className={`${button} mb-3`} disabled={busy} onClick={() => setModal(null)}>{t("close")}</button>{error && <p role="alert" className="mb-3">{t(`errors.${error}`)}</p>}
      {modal?.kind === "edit" && <PlunderPlanEditor key={`${modal.plan?.id ?? "new"}:${modal.source?.id ?? ""}`} initial={modal.plan} source={modal.source} suggestion={modal.suggestion ?? modal.plan?.kind === "suggestion"} commanders={data.commanders} zone={zone} date={date} busy={busy} onSave={(body) => save(body, t(modal.suggestion || modal.plan?.kind === "suggestion" ? "suggestionSaved" : "saved"))} />}
      {modal?.kind === "list" && <ul className="space-y-2">{eventList(modal.date)}</ul>}
      {modal?.kind === "event" && <div className="space-y-3"><h2 className="text-lg font-semibold">{eventTitle(modal.event)}</h2><p>{new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: zone }).format(new Date(modal.event.startAt))}</p><p>{t("serverTime")}: {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Etc/GMT+2" }).format(new Date(modal.event.startAt))}</p>{selectedPlan?.kind === "suggestion" && <><p>{t("suggestionHint")}</p><button className={button} disabled={!data.commanders.length} onClick={() => open({ kind: "edit", source: selectedPlan })}>{t("join")}</button>{data.canSuggest && <button className={button} onClick={() => open({ kind: "edit", plan: selectedPlan, suggestion: true })}>{t("editSuggestion")}</button>}{data.canSuggest && <button className={button} onClick={() => open({ kind: "remove", plan: selectedPlan })}>{t("removeSuggestion")}</button>}</>}{selectedPlan?.owned && selectedPlan.kind === "plan" && <div className="flex flex-wrap gap-2"><button className={button} onClick={() => open({ kind: "edit", plan: selectedPlan })}>{t("edit")}</button>{selectedPlan.schedule.kind === "weekly" && <button disabled={busy} className={button} onClick={() => void save({ action: "skip", id: selectedPlan.id, expectedVersion: selectedPlan.version, date: modal.event.localDate }, t("skipped"))}>{t("skip")}</button>}</div>}</div>}
      {modal?.kind === "remove" && <div><p>{modal.plan.kind === "suggestion" ? t("suggestionIndependent") : t("removeConfirm")}</p><button disabled={busy} className={button} onClick={() => void save({ action: "remove", id: modal.plan.id, expectedVersion: modal.plan.version }, t(modal.plan.kind === "suggestion" ? "suggestionRemoved" : "removed"))}>{t("confirm")}</button></div>}
      {modal?.kind === "color" && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save({ action: "color", color, expectedVersion: data.colorVersion }, t("color.saved")); }}><h2>{t("color.title")}</h2><p>{t("color.hint")}</p><div className="flex flex-wrap gap-2">{Object.entries(PLAN_PALETTE).map(([name, hex]) => <button type="button" className={button} style={planColorStyle(hex)} key={name} aria-pressed={color.toUpperCase() === hex} onClick={() => setColor(hex)}>{t(`color.${name as PlanColorName}`)}</button>)}</div><label className="block">{t("color.hex")}<input className="ml-2 rounded border border-hq-border bg-hq-canvas p-2" value={color} onChange={(event) => setColor(event.target.value)} pattern="#[0-9a-fA-F]{6}" required /></label>{parsePlanColor(color) && <div className="grid grid-cols-2 gap-2">{(["previewLight", "previewDark"] as const).map((mode) => <div key={mode} className={`p-3 ${mode === "previewLight" ? "bg-white" : "bg-black"}`}><span className="block rounded border p-2" style={planColorStyle(color)}>{t(`color.${mode}`)}</span></div>)}</div>}<button className={button} disabled={busy || !parsePlanColor(color)}>{t("color.apply")}</button></form>}
    </dialog>
  </main>;
}
