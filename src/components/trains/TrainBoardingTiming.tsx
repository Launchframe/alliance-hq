"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useNow, useTranslations } from "next-intl";

type Window = { recordId: string; version: number; status: string; endsAt: string | null; basis: string | null; clockToken: string; serverNow: string };
export function TrainBoardingTiming({ recordId, lockedAt, canBegin }: { recordId: string; lockedAt: string; canBegin: boolean }) {
  const t = useTranslations("calendarConnections"), locale = useLocale(), now = useNow({ updateInterval: 30_000 });
  const [window, setWindow] = useState<Window | null>(null), [loading, setLoading] = useState(true), [editing, setEditing] = useState(false);
  const [countdown, setCountdown] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const origin = useRef(0), observed = useRef(0), requestId = useRef(""), requestMode = useRef<boolean | null>(null);
  const accept = (value: Window | null) => { setWindow(value); origin.current = performance.now(); observed.current = 0; requestId.current = ""; setCountdown(""); };
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trains/boarding?recordId=${encodeURIComponent(recordId)}`).then(async (response) => {
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (!cancelled) { accept(body.boarding); setLoading(false); }
    }).catch(() => { if (!cancelled) { setError("failed"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [recordId, lockedAt]);
  async function begin() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/trains/boarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "begin", recordId }) });
      if (!response.ok) throw new Error();
      accept((await response.json()).boarding); setEditing(true);
    } catch { setError("failed"); } finally { setBusy(false); }
  }
  async function submit(skip: boolean) {
    if (!window || busy) return;
    setBusy(true); setError("");
    if (requestMode.current !== skip) { requestId.current = ""; requestMode.current = skip; }
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/trains/boarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId, version: window.version, requestId: requestId.current, clockToken: window.clockToken, elapsedMs: observed.current, countdown: skip ? null : countdown }) });
      const body = await response.json();
      if (!response.ok) { setError(body.code === "invalid_countdown" ? "boarding.invalid" : body.code === "expired" ? "boarding.expired" : body.code === "stale" ? "stale" : "failed"); return; }
      accept(body.boarding); setEditing(false);
    } catch { setError("failed"); } finally { setBusy(false); }
  }
  if (loading) return <p className="text-sm text-hq-fg-muted">{t("loading")}</p>;
  if (!window && !canBegin) return null;
  return <section className="space-y-3 rounded-lg border border-hq-border bg-hq-surface p-4" aria-label={t("boarding.title")}>
    <h2 className="font-semibold">{t("boarding.title")}</h2>
    {window?.endsAt && <p>{window.status === "closed" || Date.parse(window.endsAt) <= now.getTime() ? t("boarding.closed") : t("boarding.ends", { time: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(new Date(window.endsAt)) })}</p>}
    {window && (window.status === "pending" || editing) ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
      <label className="block space-y-1"><span>{t("boarding.question")}</span><input required pattern="[0-9]{2}:[0-5][0-9]:[0-5][0-9]" placeholder="00:00:00" value={countdown} onChange={(event) => { setCountdown(event.target.value); observed.current = performance.now() - origin.current; requestId.current = ""; }} className="block w-full max-w-xs rounded border border-hq-border bg-hq-canvas p-2" /></label>
      <p className="text-sm text-hq-fg-muted">{t("boarding.hint")}</p><p className="text-sm text-hq-fg-muted">{t("boarding.skipHint")}</p>
      <div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded border border-hq-border px-3 py-2">{t("boarding.submit")}</button><button type="button" disabled={busy} className="rounded border border-hq-border px-3 py-2" onClick={() => void submit(true)}>{t("skip")}</button></div>
    </form> : <button type="button" disabled={busy} className="rounded border border-hq-border px-3 py-2" onClick={() => void begin()}>{t("boarding.begin")}</button>}
    {window?.basis === "estimated" && <p className="text-sm text-hq-fg-muted">{t("boarding.estimate")}</p>}
    {error && <p role="alert" className="text-hq-danger">{t(error)}</p>}
    {(error === "boarding.expired" || error === "stale") && <button type="button" className="rounded border border-hq-border px-3 py-2" disabled={busy} onClick={() => void begin()}>{t("boarding.begin")}</button>}
  </section>;
}
