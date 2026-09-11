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
type TargetChange = { allianceId: string; provider: string; sources: CalendarSource[]; enabled: boolean; version: number; rotate?: boolean; cleanup?: boolean; reset?: boolean };
type CalendarConfirmation = { kind: "target"; target: Target; rotate: boolean; reset?: boolean } | { kind: "account"; version: number; email: string };

export function CalendarConnectionsClient({ initial, initialError = false }: { initial: CalendarSettingsData; initialError?: boolean }) {
  const t = useTranslations("calendarConnections"), locale = useLocale(), languages = useTranslations("language");
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState(initialError ? "failed" : "");
  const [noticeScope, setNoticeScope] = useState("page");
  const [alerts, setAlerts] = useState(initial.preferences.alerts.map((minutes, i) => ({ id: `alert-${i}`, value: String(minutes) })));
  const [language, setLanguage] = useState(initial.preferences.locale), [timezone, setTimezone] = useState(initial.preferences.timezone);
  const [confirmation, setConfirmation] = useState<CalendarConfirmation | null>(null), [cleanup, setCleanup] = useState(false);
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

  const pollGoogle = data.googleAvailable && (data.targets.some((target) => target.provider === "google" && (target.enabled || target.cleanup)) || ["disconnecting", "revoking"].includes(data.account?.status ?? ""));
  useEffect(() => {
    if (!pollGoogle) return;
    const controller = new AbortController(); let reading = false;
    const refreshStatus = async () => {
      if (reading || inFlight.current) return;
      reading = true;
      try {
        const response = await fetch(`/api/calendar/settings?locale=${locale}`, { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as CalendarSettingsData;
        if (!controller.signal.aborted) setData((current) => ({ ...current, account: result.account && (!current.account || result.account.version >= current.account.version) ? result.account : current.account,
          targets: current.targets.map((target) => { const updated = result.targets.find((row) => row.id === target.id); return !updated || updated.version < target.version ? target : { ...target, status: updated.status, lastSyncAt: updated.lastSyncAt, cleanup: updated.cleanup, creationUncertain: updated.creationUncertain }; }),
        }));
      } catch {} finally { reading = false; }
    };
    const timer = setInterval(() => void refreshStatus(), 15_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [pollGoogle, locale]);

  async function mutate(body: unknown, path = "/api/calendar/settings") {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setMessage(""); previewRequest.current?.abort(); setPreview(null); setPreviewBusy(false);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { if (alive.current) setMessage(response.status === 409 ? "stale" : "failed"); return null; }
      if (alive.current) { setData(result); setMessage("saved"); }
      return result as CalendarSettingsData;
    } catch { if (alive.current) setMessage("failed"); return null; }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function savePreferences() {
    setNoticeScope("preferences");
    try {
      const preferences = parseCalendarPreferences({ alerts: alerts.map((row) => Number(row.value)), locale: language, timezone });
      return await mutate({ action: "preferences", version: data.preferences.version, preferences });
    } catch { setMessage("invalidPreferences"); return null; }
  }
  async function configure(change: TargetChange) {
    if (change.enabled && !data.preferences.version && !await savePreferences()) return;
    setNoticeScope(`${change.allianceId}:${change.provider}`);
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
      const result = await response.json();
      if (!response.ok) throw new Error();
      if (!controller.signal.aborted) setPreview(result.events);
    } catch { if (!controller.signal.aborted) setMessage("failed"); }
    finally { if (!controller.signal.aborted) setPreviewBusy(false); }
  }
  async function connectGoogle() {
    if (inFlight.current) return;
    if (!data.preferences.version && !await savePreferences()) return;
    setBusy(true); setMessage(""); setNoticeScope("google"); inFlight.current = true;
    try {
      const response = await fetch("/api/calendar/google/start", { method: "POST" });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error();
      if (alive.current) window.location.assign(result.url);
    } catch { if (alive.current) { setBusy(false); setMessage("failed"); } }
    finally { inFlight.current = false; }
  }
  function openConfirmation(value: CalendarConfirmation) { setMessage(""); setCleanup(false); setConfirmation(value); }
  const targetConfirmation = confirmation?.kind === "target" ? confirmation : null;
  const confirmationKey = targetConfirmation?.rotate ? "rotate" : targetConfirmation?.reset ? "resetCalendar" : "disconnect";
  async function confirmChange() {
    if (confirmation?.kind === "account") {
      const saved = await mutate({ version: confirmation.version, cleanup }, "/api/calendar/google/disconnect");
      if (saved) setConfirmation(null);
    } else if (targetConfirmation) {
      const { target, rotate, reset } = targetConfirmation;
      await configure({ allianceId: target.allianceId, provider: target.provider, sources: target.sources, version: target.version, enabled: rotate || !!reset, rotate, reset, cleanup });
    }
  }
  const dateLabel = (value: string, allDay: boolean) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...(allDay ? {} : { timeStyle: "short" }), timeZone: allDay ? "UTC" : data.preferences.timezone }).format(new Date(allDay ? `${value}T12:00:00Z` : value));

  return <main className="mx-auto w-full min-w-0 max-w-4xl space-y-6 p-4">
    <header className="space-y-2"><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("title")}</h1><p>{t("description")}</p><p className="text-sm text-hq-fg-muted">{t("authority")}</p></header>
    {message === "saved" && <p role="status">{t("saved")}</p>}{noticeScope === "page" && <CalendarActionError code={message} />}
    <form aria-label={t("alerts")} className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4" onSubmit={(event) => { event.preventDefault(); void savePreferences(); }}>
      <h2 className="text-lg font-semibold">{t("alerts")}</h2><p className="text-sm text-hq-fg-muted">{t("alertsHint")}</p>
      {!alerts.length && <p>{t("off")}</p>}
      {alerts.map((row, index) => <div key={row.id} className="flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1"><span>{t("minutes")}</span><input className={field} type="number" min={1} max={40320} step={1} required value={row.value} onChange={(event) => setAlerts((current) => current.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} /></label><button type="button" className={button} disabled={busy} aria-label={`${t("removeAlert")} ${index + 1}`} onClick={() => setAlerts((current) => current.filter((item) => item.id !== row.id))}>{t("removeAlert")}</button></div>)}
      <button type="button" className={button} disabled={busy || alerts.length >= 5} onClick={() => setAlerts((current) => [...current, { id: crypto.randomUUID(), value: "" }])}>{t("addAlert")}</button>
      <p className="text-sm text-hq-fg-muted">{t("alertLimit")}</p>
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span>{t("locale")}</span><select className={field} value={language} onChange={(event) => setLanguage(event.target.value as "en-US" | "pt-BR")}><option value="en-US">{languages("en-US")}</option><option value="pt-BR">{languages("pt-BR")}</option></select></label><label className="space-y-1"><span>{t("timezone")}</span><input className={field} required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label></div>
      <button className={button} disabled={busy}>{t("save")}</button>{noticeScope === "preferences" && <CalendarActionError code={message} />}<p className="text-sm text-hq-fg-muted">{t("pastAlert")}</p>
    </form>
    {(data.googleAvailable || data.account) && <section aria-label={t("google")} className="space-y-2 rounded-xl border border-hq-border bg-hq-surface p-4">
      <h2 className="text-lg font-semibold">{t("google")}</h2>{data.account && <p>{data.account.email}</p>}
      {data.account?.status === "connected" ? <><p role="status">{t("status.connected")}</p><button className={button} disabled={busy} onClick={() => { if (data.account) { openConfirmation({ kind: "account", version: data.account.version, email: data.account.email }); } }}>{t("disconnect")}</button></> : ["disconnecting", "revoking"].includes(data.account?.status ?? "") ? <p role="status">{t("status.cleanup")}</p> : data.googleAvailable && <button className={button} disabled={busy} onClick={() => void connectGoogle()}>{t("connect")}</button>}
      {noticeScope === "google" && <CalendarActionError code={message} />}
      {data.account?.status === "revocation_uncertain" && <p role="alert">{t("revocationHint")}</p>}
      {data.targets.some((target) => target.provider === "google" && !target.enabled && target.status === "failed") && <p role="alert">{t("cleanupIncomplete")}</p>}
    </section>}
    <p className="text-sm text-hq-fg-muted">{t("duplicateHint")}</p>
    {data.alliances.map((alliance) => <section key={alliance.id} className="space-y-3"><h2 className="text-lg font-semibold">{alliance.tag || alliance.name}</h2>{(["apple", ...(data.account || data.targets.some((target) => target.provider === "google" && target.allianceId === alliance.id) ? ["google"] : [])] as const).map((provider) => {
      const target = data.targets.find((row) => row.allianceId === alliance.id && row.provider === provider);
      return <CalendarTargetCard key={`${provider}:${target?.version ?? 0}`} alliance={alliance} provider={provider} target={target} busy={busy} actionError={!confirmation && noticeScope === `${alliance.id}:${provider}` ? message : ""} timezone={data.preferences.timezone} canEnable={provider === "apple" || data.account?.status === "connected"} onSave={configure} onPreview={(id, sources) => { setNoticeScope(`${id}:${provider}`); return showPreview(id, sources); }} onConfirm={(target, rotate, reset) => { openConfirmation({ kind: "target", target, rotate, reset }); }} />;
    })}</section>)}
    {data.targets.filter((target) => !data.alliances.some((alliance) => alliance.id === target.allianceId)).map((target) => <section key={target.id} className="space-y-2 rounded border border-hq-border p-3"><h2>{t(target.provider === "apple" ? "apple" : "google")}</h2><p>{t("disconnectHint")}</p><button className={button} disabled={busy} onClick={() => { openConfirmation({ kind: "target", target, rotate: false }); }}>{t("disconnect")}</button></section>)}
    {(previewBusy || preview) && <section aria-label={t("preview")} className="space-y-3 rounded-xl border border-hq-border p-4"><h2 className="text-lg font-semibold">{t("preview")}</h2>{previewBusy ? <p role="status">{t("loading")}</p> : !preview?.length ? <p>{t("empty")}</p> : <ul className="space-y-3">{preview.map((event) => <li key={event.key}><p className="font-medium">{event.title}</p><p className="text-sm">{dateLabel(event.start, event.allDay)} – {dateLabel(event.allDay ? addCalendarDays(event.end, -1) : event.end, event.allDay)}</p><Link className="text-hq-accent underline" href={event.path}>{t("preview")}</Link></li>)}</ul>}</section>}
    <p className="text-sm text-hq-fg-muted">{t("privacyDisclosure")}</p>
    <dialog ref={dialog} role="dialog" aria-modal={confirmation ? true : undefined} aria-label={t(confirmationKey)} className="max-h-[90vh] w-[min(95vw,36rem)] space-y-4 overflow-auto rounded-xl border border-hq-border bg-hq-canvas p-5 text-hq-fg backdrop:bg-black/60" onCancel={(event) => { if (busy) event.preventDefault(); else setConfirmation(null); }}>
      <h2 className="text-lg font-semibold">{t(confirmationKey)}</h2><p>{t(targetConfirmation?.reset ? "resetHint" : targetConfirmation?.rotate ? "rotateHint" : "disconnectHint")}</p>
      {confirmation?.kind === "account" && <p>{confirmation.email}</p>}
      {(confirmation?.kind === "account" || targetConfirmation?.target.provider === "google" && !targetConfirmation.rotate && !targetConfirmation.reset) && <label className="flex gap-2"><input type="checkbox" checked={cleanup} onChange={(event) => setCleanup(event.target.checked)} />{t("cleanup")}</label>}
      <CalendarActionError code={confirmation ? message : ""} />
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => setConfirmation(null)}>{t("cancel")}</button><button className={button} disabled={busy} onClick={() => void confirmChange()}>{t(confirmationKey)}</button></div>
    </dialog>
  </main>;
}

function CalendarTargetCard({ alliance, provider, target, busy, canEnable, timezone, actionError, onSave, onPreview, onConfirm }: { alliance: Alliance; provider: string; target?: Target; busy: boolean; canEnable: boolean; timezone: string; actionError: string; onSave: (change: TargetChange) => Promise<void>; onPreview: (id: string, sources: CalendarSource[]) => Promise<void>; onConfirm: (target: Target, rotate: boolean, reset?: boolean) => void }) {
  const t = useTranslations("calendarConnections"), locale = useLocale();
  const [sources, setSources] = useState(target?.sources ?? alliance.sources), [enabled, setEnabled] = useState(target?.enabled ?? false);
  const [link, setLink] = useState(""), [linkBusy, setLinkBusy] = useState(false), [error, setError] = useState(false), [copied, setCopied] = useState(false);
  async function showLink() {
    if (!target || linkBusy) return;
    setLinkBusy(true); setError(false);
    try { const response = await fetch("/api/calendar/feed-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: target.id }) }); const result = await response.json(); if (!response.ok) throw new Error(); setLink(result.url); } catch { setError(true); } finally { setLinkBusy(false); }
  }
  return <form aria-label={`${alliance.tag || alliance.name} — ${t(provider === "apple" ? "apple" : "google")}`} className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4" onSubmit={(event) => { event.preventDefault(); void onSave({ allianceId: alliance.id, provider, sources, enabled, version: target?.version ?? 0 }); }}>
    <h3 className="font-semibold">{t(provider === "apple" ? "apple" : "google")}</h3><label className="flex gap-2"><input type="checkbox" checked={enabled} disabled={busy || !canEnable && !enabled} onChange={(event) => setEnabled(event.target.checked)} />{t("enable")}</label>
    <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="sr-only">{t("preview")}</legend>{alliance.sources.map((source) => <label key={source} className="flex gap-2"><input type="checkbox" checked={sources.includes(source)} onChange={(event) => setSources((current) => event.target.checked ? [...current, source] : current.filter((value) => value !== source))} />{t(`sources.${source}`)}</label>)}</fieldset>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || (!target && !enabled)}>{t("save")}</button><button type="button" className={button} disabled={busy} onClick={() => void onPreview(alliance.id, sources)}>{t("preview")}</button>{target && (target.enabled || target.cleanup) && <button type="button" className={button} disabled={busy} onClick={() => onConfirm(target, false)}>{t("disconnect")}</button>}</div>
    <CalendarActionError code={actionError} />
    {target?.enabled && provider === "apple" && <div className="space-y-3"><p className="text-sm text-hq-fg-muted">{t("privacy")}</p><p className="text-sm text-hq-fg-muted">{t("appleHint")}</p><p className="text-sm text-hq-fg-muted">{t("appleAlerts")}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || linkBusy} onClick={() => void showLink()}>{t("subscribe")}</button><button type="button" className={button} disabled={busy} onClick={() => onConfirm(target, true)}>{t("rotate")}</button></div>{link && <div className="space-y-2"><p>{t("subscribeInstructions")}</p><input type="password" readOnly aria-label={t("privateLink")} value={link} className={field} /><button type="button" className={button} onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError(true)); }}>{t("privateLink")}</button>{copied && <p role="status">{t("copied")}</p>}</div>}<CalendarActionError code={error ? "failed" : ""} /></div>}
    {target && provider === "google" && <div className="space-y-2"><p role="status">{t(`status.${["pending", "connected", "synced", "creating", "uncertain", "reconnect", "failed", "disabled", "cleanup", "calendar_missing"].includes(target.status) ? target.status : "pending"}`)}</p>{target.lastSyncAt && <p className="text-sm text-hq-fg-muted">{t("lastSync", { time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(target.lastSyncAt)) })}</p>}{canEnable && (target.creationUncertain || target.status === "calendar_missing") && <button type="button" className={button} disabled={busy || target.status === "creating"} onClick={() => onConfirm(target, false, true)}>{t("resetCalendar")}</button>}</div>}
  </form>;
}

function CalendarActionError({ code }: { code: string }) {
  const t = useTranslations("calendarConnections"), anchor = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (code && code !== "saved") anchor.current?.scrollIntoView({ block: "nearest" }); }, [code]);
  return code && code !== "saved" ? <p ref={anchor} role="alert" className="text-sm text-hq-danger">{t(code)}</p> : null;
}
