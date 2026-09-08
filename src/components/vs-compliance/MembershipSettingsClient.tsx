"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { mergeVsPolicyPatch } from "@/lib/vs-compliance/policy.shared";
import type { VsPolicyVersion } from "@/lib/vs-compliance/types.shared";
import { ComplianceClientError, isMembershipSettings, isPolicy, readComplianceResponse, RequestVersion, type MembershipSettings } from "./client.shared";

const inputClass = "block w-full rounded border border-hq-border bg-hq-surface p-2 disabled:opacity-60";
const buttonClass = "rounded border border-hq-border px-3 py-2 text-sm disabled:opacity-50";
type Draft = { enabled: boolean; dailyTarget: string; weeklyMinimum: string; leewayPct: string; preset: "rank_aware" | "consecutive"; removalThreshold: string; effectiveWeek: string };

export function MembershipSettingsClient({ allianceTag, earliestWeek }: { allianceTag: string; earliestWeek: string }) {
  const t = useTranslations("vsCompliance");
  const all = useTranslations();
  const locale = useLocale();
  const [settings, setSettings] = useState<MembershipSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const requests = useRef(new RequestVersion());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const endpoint = `/api/alliance/${encodeURIComponent(allianceTag)}/vs-membership-minimums`;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const number = (value: number | null) => value === null ? all("commandersIndex.unreportedShort") : new Intl.NumberFormat(locale).format(value);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const load = useCallback(async () => {
    const version = requests.current.next();
    setLoading(true); setError(null);
    try {
      const data = await readComplianceResponse(await fetch(endpoint, { cache: "no-store" }), all("statSync.actionFailed"));
      if (!isMembershipSettings(data)) throw new Error(all("statSync.actionFailed"));
      if (!requests.current.current(version)) return;
      const payload = data as MembershipSettings;
      const policy = payload.latest ?? payload.defaults;
      setSettings(payload);
      setDraft({ enabled: policy.enabled, dailyTarget: String(policy.dailyTarget), weeklyMinimum: policy.weeklyMinimum === null ? "" : String(policy.weeklyMinimum), leewayPct: String(policy.leewayPct), preset: policy.preset, removalThreshold: String(policy.removalThreshold), effectiveWeek: payload.latest && payload.latest.effectiveWeek > earliestWeek ? payload.latest.effectiveWeek : earliestWeek });
    } catch (failure) { if (requests.current.current(version)) setError(failure instanceof ComplianceClientError ? failure.message : all("statSync.actionFailed")); }
    finally { if (requests.current.current(version)) setLoading(false); }
  }, [all, earliestWeek, endpoint]);
  useEffect(() => {
    const version = requests.current;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); version.next(); };
  }, [load]);

  async function save() {
    if (inFlight.current || !settings?.canManage || !draft) return;
    inFlight.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      const patch = { ...draft, dailyTarget: Number(draft.dailyTarget), weeklyMinimum: draft.weeklyMinimum.trim() ? Number(draft.weeklyMinimum) : null, leewayPct: Number(draft.leewayPct), removalThreshold: Number(draft.removalThreshold) };
      try { mergeVsPolicyPatch(settings.latest, patch, new Date()); } catch { throw new Error(all("statSync.actionFailed")); }
      const data = await readComplianceResponse(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: settings.latest?.version ?? 0, ...patch }) }), all("statSync.actionFailed"));
      if (!isPolicy(data.latest)) throw new Error(all("statSync.actionFailed"));
      setSettings({ ...settings, latest: data.latest, history: [data.latest, ...settings.history] });
      setSaved(true);
    } catch (failure) { setError(failure instanceof ComplianceClientError ? failure.message : all("statSync.actionFailed")); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const minimumWeek = settings?.latest && settings.latest.effectiveWeek > earliestWeek ? settings.latest.effectiveWeek : earliestWeek;
  const policyDetails = (policy: VsPolicyVersion) => <article key={policy.version} className="space-y-2 rounded border border-hq-border p-4">
    <h3 className="font-medium">{t("effectiveFrom")}: {all("videoReview.vsWeeklyDateOption", { date: date(policy.effectiveWeek) })} · {all("shell.version", { version: number(policy.version) })}</h3>
    <label className="flex items-center gap-2"><input type="checkbox" checked={policy.enabled} disabled readOnly />{t("enabled")}</label>
    <p>{t("dailyTarget")}: {number(policy.dailyTarget)}</p><p>{t("weeklyMinimum")}: {number(policy.weeklyMinimum)}</p><p>{t("leeway")}: {number(policy.leewayPct)}</p>
    <p>{t("preset")}: {t(policy.preset === "rank_aware" ? "rankAware" : "consecutive")}</p>
    {policy.preset === "consecutive" ? <p>{t("removalThreshold")}: {number(policy.removalThreshold)}</p> : null}
  </article>;
  return <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
    <header className="space-y-2"><Link href="/vs-compliance" className="text-hq-accent underline">{t("title")}</Link><h1 className="text-2xl font-semibold">{t("settings")}</h1><p>{allianceTag}</p></header>
    {loading ? <p role="status">{all("common.loading")}</p> : null}
    {draft && settings ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!settings.canManage || busy || loading} className="space-y-4">
        <label className="block space-y-2">{t("dailyTarget")}<input required type="number" min={1} step={1} value={draft.dailyTarget} onChange={(event) => setDraft({ ...draft, dailyTarget: event.target.value })} className={inputClass} /></label>
        <p className="text-sm text-hq-fg-muted">{t("dailyHint")}</p>
        <label className="block space-y-2">{t("weeklyMinimum")}<input type="number" required={draft.enabled} min={1} step={1} value={draft.weeklyMinimum} onChange={(event) => setDraft({ ...draft, weeklyMinimum: event.target.value })} className={inputClass} /></label>
        <label className="block space-y-2">{t("leeway")}<input required type="number" min={0} max={100} step={1} value={draft.leewayPct} onChange={(event) => setDraft({ ...draft, leewayPct: event.target.value })} className={inputClass} /></label>
        <label className="block space-y-2">{t("preset")}<select value={draft.preset} onChange={(event) => setDraft({ ...draft, preset: event.target.value as Draft["preset"] })} className={inputClass}><option value="rank_aware">{t("rankAware")}</option><option value="consecutive">{t("consecutive")}</option></select></label>
        <p className="text-sm text-hq-fg-muted">{t(draft.preset === "rank_aware" ? "rankAwareHint" : "consecutiveHint")}</p>
        {draft.preset === "consecutive" ? <label className="block space-y-2">{t("removalThreshold")}<input required type="number" min={3} max={2147483647} step={1} value={draft.removalThreshold} onChange={(event) => setDraft({ ...draft, removalThreshold: event.target.value })} className={inputClass} /></label> : null}
        <label className="block space-y-2">{t("effectiveFrom")}<input required type="date" min={minimumWeek} step={7} value={draft.effectiveWeek} onChange={(event) => setDraft({ ...draft, effectiveWeek: event.target.value })} className={inputClass} /></label>
        <p className="text-sm">{all("videoReview.vsWeeklyDateOption", { date: date(draft.effectiveWeek || minimumWeek) })}</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{t("enabled")}</label>
      </fieldset>
      <p className="text-sm text-hq-fg-muted">{t("resetHint")}</p><p className="text-sm text-hq-fg-muted">{t("manualHint")}</p>
      {error ? <p ref={errorRef} role="alert" className="text-hq-danger">{error}</p> : null}
      {saved ? <p role="status">{t("saved")}</p> : null}
      {settings.canManage ? <button type="submit" disabled={busy || loading} className={buttonClass}>{busy ? all("common.loading") : all("commandersIndex.save")}</button> : null}
    </form> : error ? <p ref={errorRef} role="alert" className="text-hq-danger">{error}</p> : null}
    <button type="button" disabled={busy || loading} className={buttonClass} onClick={() => void load()}>{all("timeOff.unexpectedReport.refresh")}</button>
    {settings?.history.length ? <section className="space-y-3"><h2 className="text-lg font-semibold">{all("timeOff.workflow.history")}</h2>{settings.history.map(policyDetails)}</section> : null}
  </div>;
}
