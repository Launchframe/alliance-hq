"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { addCalendarDays } from "@/lib/trains/game-time";
import { parseCalendarPreferences } from "@/lib/calendar/preferences.shared";
import type { CalendarEvent, CalendarSource } from "@/lib/calendar/types.shared";
import type { CalendarSettingsData } from "@/lib/calendar/settings.server";

const button = "min-h-11 rounded border border-hq-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-hq-accent disabled:opacity-50";
const field = "min-h-11 w-full rounded border border-hq-border bg-hq-canvas p-2";
type Target = CalendarSettingsData["targets"][number];
type Alliance = CalendarSettingsData["alliances"][number];
type TargetChange = { allianceId: string; provider: string; sources: CalendarSource[]; enabled: boolean; version: number; rotate?: boolean; cleanup?: boolean };

export function CalendarConnectionsClient({ initial }: { initial: CalendarSettingsData }) {
  const t = useTranslations("calendarConnections"), locale = useLocale(), languages = useTranslations("language");
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [alerts, setAlerts] = useState(initial.preferences.alerts.map((minutes, i) => ({ id: `alert-${i}`, value: String(minutes) })));
  const [language, setLanguage] = useState(initial.preferences.locale), [timezone, setTimezone] = useState(initial.preferences.timezone);
  const [confirmation, setConfirmation] = useState<{ target: Target; rotate: boolean } | null>(null), [cleanup, setCleanup] = useState(false);
  const [preview, setPreview] = useState<CalendarEvent[] | null>(null), [previewBusy, setPreviewBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), inFlight = useRef(false), previewRequest = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; previewRequest.current?.abort(); }; }, []);
  useEffect(() => {
    const element = dialog.current;
    if (confirmation) element?.showModal();
    else if (element?.open) {
      element.close();
      if (document.activeElement === document.body || element.contains(document.activeElement)) heading.current?.focus();
    }
  }, [confirmation]);

  async function mutate(body: unknown) {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setMessage(""); previewRequest.current?.abort(); setPreview(null); setPreviewBusy(false);
    try {
      const response = await fetch("/api/calendar/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { if (alive.current) setMessage(response.status === 409 ? "stale" : "failed"); return null; }
      if (alive.current) { setData(result); setMessage("saved"); }
      return result as CalendarSettingsData;
    } catch { if (alive.current) setMessage("failed"); return null; }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function savePreferences() {
    try {
      const preferences = parseCalendarPreferences({ alerts: alerts.map((row) => Number(row.value)), locale: language, timezone });
      return await mutate({ action: "preferences", version: data.preferences.version, preferences });
    } catch { setMessage("invalidPreferences"); return null; }
  }
  async function configure(change: TargetChange) {
    if (change.enabled && !data.preferences.version && !await savePreferences()) return;
    const saved = await mutate({ action: "target", ...change });
    if (saved) { setConfirmation(null); heading.current?.focus(); }
  }
  async function showPreview(allianceId: string, sources: CalendarSource[]) {
    previewRequest.current?.abort();
    const controller = new AbortController(); previewRequest.current = controller;
    setPreviewBusy(true); setMessage(""); setPreview(null);
    try {
      const params = new URLSearchParams({ allianceId }); for (const source of sources) params.append("source", source);
      const response = await fetch(`/api/calendar/preview?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!controller.signal.aborted) setPreview(result.events);
    } catch { if (!controller.signal.aborted) setMessage("failed"); }
    finally { if (!controller.signal.aborted) setPreviewBusy(false); }
  }
  async function connectGoogle() {
    if (inFlight.current) return;
    if (!data.preferences.version && !await savePreferences()) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/calendar/google/start", { method: "POST" });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error();
      if (alive.current) window.location.assign(result.url);
    } catch { if (alive.current) { setBusy(false); setMessage("failed"); } }
  }
  const dateLabel = (value: string, allDay: boolean) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...(allDay ? {} : { timeStyle: "short" }), timeZone: allDay ? "UTC" : data.preferences.timezone }).format(new Date(allDay ? `${value}T12:00:00Z` : value));

  return <main className="mx-auto w-full min-w-0 max-w-4xl space-y-6 p-4">
    <header className="space-y-2"><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("title")}</h1><p>{t("description")}</p><p className="text-sm text-hq-fg-muted">{t("authority")}</p></header>
    {message && <p role={message === "saved" ? "status" : "alert"} className={message === "saved" ? "text-hq-fg" : "text-hq-danger"}>{t(message)}</p>}
    <form aria-label={t("alerts")} className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4" onSubmit={(event) => { event.preventDefault(); void savePreferences(); }}>
      <h2 className="text-lg font-semibold">{t("alerts")}</h2><p className="text-sm text-hq-fg-muted">{t("alertsHint")}</p>
      {!alerts.length && <p>{t("off")}</p>}
      {alerts.map((row, index) => <div key={row.id} className="flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1"><span>{t("minutes")}</span><input className={field} type="number" min={1} max={40320} step={1} required value={row.value} onChange={(event) => setAlerts((current) => current.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} /></label><button type="button" className={button} disabled={busy} aria-label={`${t("removeAlert")} ${index + 1}`} onClick={() => setAlerts((current) => current.filter((item) => item.id !== row.id))}>{t("removeAlert")}</button></div>)}
      <button type="button" className={button} disabled={busy || alerts.length >= 5} onClick={() => setAlerts((current) => [...current, { id: crypto.randomUUID(), value: "" }])}>{t("addAlert")}</button>
      <p className="text-sm text-hq-fg-muted">{t("alertLimit")}</p>
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span>{t("locale")}</span><select className={field} value={language} onChange={(event) => setLanguage(event.target.value as "en-US" | "pt-BR")}><option value="en-US">{languages("en-US")}</option><option value="pt-BR">{languages("pt-BR")}</option></select></label><label className="space-y-1"><span>{t("timezone")}</span><input className={field} required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label></div>
      <button className={button} disabled={busy}>{t("save")}</button><p className="text-sm text-hq-fg-muted">{t("pastAlert")}</p>
    </form>
    {data.googleAvailable && <section className="space-y-2 rounded-xl border border-hq-border bg-hq-surface p-4"><h2 className="text-lg font-semibold">{t("google")}</h2>{data.account && <p>{data.account.email}</p>}{data.account?.status === "connected" ? <p role="status">{t("status.connected")}</p> : <button className={button} disabled={busy} onClick={() => void connectGoogle()}>{t("connect")}</button>}</section>}
    <p className="text-sm text-hq-fg-muted">{t("duplicateHint")}</p>
    {data.alliances.map((alliance) => <section key={alliance.id} className="space-y-3"><h2 className="text-lg font-semibold">{alliance.tag || alliance.name}</h2>{(["apple", ...(data.account?.status === "connected" ? ["google"] : [])] as const).map((provider) => {
      const target = data.targets.find((row) => row.allianceId === alliance.id && row.provider === provider);
      return <CalendarTargetCard key={`${provider}:${target?.version ?? 0}`} alliance={alliance} provider={provider} target={target} busy={busy} onSave={configure} onPreview={showPreview} onConfirm={(target, rotate) => { setCleanup(false); setConfirmation({ target, rotate }); }} />;
    })}</section>)}
    {data.targets.filter((target) => !data.alliances.some((alliance) => alliance.id === target.allianceId)).map((target) => <section key={target.id} className="space-y-2 rounded border border-hq-border p-3"><h2>{t(target.provider === "apple" ? "apple" : "google")}</h2><p>{t("disconnectHint")}</p><button className={button} disabled={busy} onClick={() => { setCleanup(false); setConfirmation({ target, rotate: false }); }}>{t("disconnect")}</button></section>)}
    {(previewBusy || preview) && <section aria-label={t("preview")} className="space-y-3 rounded-xl border border-hq-border p-4"><h2 className="text-lg font-semibold">{t("preview")}</h2>{previewBusy ? <p role="status">{t("loading")}</p> : !preview?.length ? <p>{t("empty")}</p> : <ul className="space-y-3">{preview.map((event) => <li key={event.key}><p className="font-medium">{event.title}</p><p className="text-sm">{dateLabel(event.start, event.allDay)} – {dateLabel(event.allDay ? addCalendarDays(event.end, -1) : event.end, event.allDay)}</p><Link className="text-hq-accent underline" href={event.path}>{t("preview")}</Link></li>)}</ul>}</section>}
    <p className="text-sm text-hq-fg-muted">{t("privacyDisclosure")}</p>
    <dialog ref={dialog} role="dialog" aria-modal={confirmation ? true : undefined} aria-label={t(confirmation?.rotate ? "rotate" : "disconnect")} className="max-h-[90vh] w-[min(95vw,36rem)] space-y-4 overflow-auto rounded-xl border border-hq-border bg-hq-canvas p-5 text-hq-fg backdrop:bg-black/60" onCancel={(event) => { if (busy) event.preventDefault(); else setConfirmation(null); }}>
      <h2 className="text-lg font-semibold">{t(confirmation?.rotate ? "rotate" : "disconnect")}</h2><p>{t(confirmation?.rotate ? "rotateHint" : "disconnectHint")}</p>
      {confirmation?.target.provider === "google" && !confirmation.rotate && <label className="flex gap-2"><input type="checkbox" checked={cleanup} onChange={(event) => setCleanup(event.target.checked)} />{t("cleanup")}</label>}
      {message && message !== "saved" && <p role="alert">{t(message)}</p>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => setConfirmation(null)}>{t("cancel")}</button><button className={button} disabled={busy} onClick={() => { if (confirmation) void configure({ allianceId: confirmation.target.allianceId, provider: confirmation.target.provider, sources: confirmation.target.sources, version: confirmation.target.version, enabled: confirmation.rotate, rotate: confirmation.rotate, cleanup }); }}>{t(confirmation?.rotate ? "rotate" : "disconnect")}</button></div>
    </dialog>
  </main>;
}

function CalendarTargetCard({ alliance, provider, target, busy, onSave, onPreview, onConfirm }: { alliance: Alliance; provider: string; target?: Target; busy: boolean; onSave: (change: TargetChange) => Promise<void>; onPreview: (id: string, sources: CalendarSource[]) => Promise<void>; onConfirm: (target: Target, rotate: boolean) => void }) {
  const t = useTranslations("calendarConnections");
  const [sources, setSources] = useState(target?.sources ?? alliance.sources), [enabled, setEnabled] = useState(target?.enabled ?? false);
  const [link, setLink] = useState(""), [linkBusy, setLinkBusy] = useState(false), [error, setError] = useState(false), [copied, setCopied] = useState(false);
  async function showLink() {
    if (!target || linkBusy) return;
    setLinkBusy(true); setError(false);
    try { const response = await fetch("/api/calendar/feed-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: target.id }) }); if (!response.ok) throw new Error(); setLink((await response.json()).url); } catch { setError(true); } finally { setLinkBusy(false); }
  }
  return <form aria-label={`${alliance.tag || alliance.name} — ${t(provider === "apple" ? "apple" : "google")}`} className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4" onSubmit={(event) => { event.preventDefault(); void onSave({ allianceId: alliance.id, provider, sources, enabled, version: target?.version ?? 0 }); }}>
    <h3 className="font-semibold">{t(provider === "apple" ? "apple" : "google")}</h3><label className="flex gap-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{t("enable")}</label>
    <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="sr-only">{t("preview")}</legend>{alliance.sources.map((source) => <label key={source} className="flex gap-2"><input type="checkbox" checked={sources.includes(source)} onChange={(event) => setSources((current) => event.target.checked ? [...current, source] : current.filter((value) => value !== source))} />{t(`sources.${source}`)}</label>)}</fieldset>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || (!target && !enabled)}>{t("save")}</button><button type="button" className={button} disabled={busy} onClick={() => void onPreview(alliance.id, sources)}>{t("preview")}</button>{target?.enabled && <button type="button" className={button} disabled={busy} onClick={() => onConfirm(target, false)}>{t("disconnect")}</button>}</div>
    {target?.enabled && provider === "apple" && <div className="space-y-3"><p className="text-sm text-hq-fg-muted">{t("privacy")}</p><p className="text-sm text-hq-fg-muted">{t("appleHint")}</p><p className="text-sm text-hq-fg-muted">{t("appleAlerts")}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || linkBusy} onClick={() => void showLink()}>{t("subscribe")}</button><button type="button" className={button} disabled={busy} onClick={() => onConfirm(target, true)}>{t("rotate")}</button></div>{link && <div className="space-y-2"><p>{t("subscribeInstructions")}</p><input type="password" readOnly aria-label={t("privateLink")} value={link} className={field} /><button type="button" className={button} onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError(true)); }}>{t("privateLink")}</button>{copied && <p role="status">{t("copied")}</p>}</div>}{error && <p role="alert">{t("failed")}</p>}</div>}
    {target && provider === "google" && <p role="status">{t(`status.${["pending", "connected", "synced", "creating", "uncertain", "reconnect", "failed", "disabled", "cleanup"].includes(target.status) ? target.status : "pending"}`)}</p>}
  </form>;
}
