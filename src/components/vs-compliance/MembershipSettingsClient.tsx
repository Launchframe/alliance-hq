"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { mergeVsPolicyPatch, vsThreshold } from "@/lib/vs-compliance/policy.shared";
import type { VsPolicyVersion } from "@/lib/vs-compliance/types.shared";
import { VS_PREVIEW_OUTCOME_KEYS, vsPolicyEditorDraft, vsPolicyPatchFromDraft, vsPreviewIncomplete, type VsPolicyPreviewRow } from "@/lib/vs-compliance/policy-editor.shared";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { ComplianceClientError, isMembershipSettings, isPolicy, isPolicyPreview, readComplianceResponse, RequestVersion, type MembershipSettings, type VsPolicyPreviewResponse } from "./client.shared";

const inputClass = "block w-full rounded border border-hq-border bg-hq-surface p-2 disabled:opacity-60";
const buttonClass = "rounded border border-hq-border px-3 py-2 text-sm disabled:opacity-50";
type Draft = ReturnType<typeof vsPolicyEditorDraft>;
type PreviewResult = { key: string; response: VsPolicyPreviewResponse };

function sequenceSelect(unit: string, onChange: (unit: "days" | "weeks") => void, label: string, t: (key: "days" | "weeks") => string) {
  return <select aria-label={label} value={unit} onChange={(event) => onChange(event.target.value === "days" ? "days" : "weeks")} className={inputClass}>
    <option value="days">{t("days")}</option>
    <option value="weeks">{t("weeks")}</option>
  </select>;
}

export function MembershipSettingsClient({ allianceTag, earliestWeek }: { allianceTag: string; earliestWeek: string }) {
  const t = useTranslations("vsCompliance");
  const tp = useTranslations("vsPerformance.policy");
  const tMembers = useTranslations("vsPerformance.members");
  const all = useTranslations();
  const locale = useLocale();
  const [settings, setSettings] = useState<MembershipSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewWeek, setPreviewWeek] = useState(() => lastClosedVsWeek());
  const [previewWeekInvalid, setPreviewWeekInvalid] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const inFlight = useRef(false);
  const requests = useRef(new RequestVersion());
  const previewRequests = useRef(new RequestVersion());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const endpoint = `/api/alliance/${encodeURIComponent(allianceTag)}/vs-membership-minimums`;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const number = (value: number | null) => value === null ? all("commandersIndex.unreportedShort") : new Intl.NumberFormat(locale).format(value);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);

  const load = useCallback(async () => {
    const version = requests.current.next();
    previewRequests.current.next();
    setLoading(true); setError(null); setPreview(null); setPreviewError(false);
    try {
      const data = await readComplianceResponse(await fetch(endpoint, { cache: "no-store" }), all("statSync.actionFailed"));
      if (!isMembershipSettings(data)) throw new Error(all("statSync.actionFailed"));
      if (!requests.current.current(version)) return;
      const payload = data as MembershipSettings;
      setSettings(payload);
      setDraft(vsPolicyEditorDraft(payload.latest, new Date()));
    } catch (failure) { if (requests.current.current(version)) setError(failure instanceof ComplianceClientError ? failure.message : all("statSync.actionFailed")); }
    finally { if (requests.current.current(version)) setLoading(false); }
  }, [all, endpoint]);
  useEffect(() => {
    const version = requests.current;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); version.next(); };
  }, [load]);

  const patch = useMemo(() => draft ? vsPolicyPatchFromDraft(draft) : null, [draft]);
  const previewKey = useMemo(() => patch ? JSON.stringify({ patch, weekEnding: previewWeek }) : null, [patch, previewWeek]);
  const effectiveMinimum = useMemo(() => {
    if (!patch) return null;
    try { return vsThreshold(patch.dailyTarget as number, patch.leewayPct as number); } catch { return null; }
  }, [patch]);

  async function save() {
    if (inFlight.current || !settings?.canManage || !draft) return;
    if (!patch) { setError(tp("invalid")); return; }
    inFlight.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      try { mergeVsPolicyPatch(settings.latest, patch, new Date()); } catch { setError(tp("invalid")); return; }
      const data = await readComplianceResponse(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: settings.latest?.version ?? 0, ...patch }) }), all("statSync.actionFailed"));
      if (!isPolicy(data.latest)) throw new Error(all("statSync.actionFailed"));
      setSettings({ ...settings, latest: data.latest, history: [data.latest, ...settings.history] });
      setSaved(true);
    } catch (failure) { setError(failure instanceof ComplianceClientError && failure.code === "changed" ? tp("changed") : failure instanceof ComplianceClientError ? failure.message : all("statSync.actionFailed")); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function runPreview() {
    if (previewBusy) return;
    if (!patch) { setPreviewError(true); return; }
    if (!validateVsPeriod(previewWeek, "weekly") || previewWeek > lastClosedVsWeek()) { setPreviewWeekInvalid(true); return; }
    const requestedWeek = previewWeek;
    const version = previewRequests.current.next();
    const key = previewKey!;
    setPreviewBusy(true); setPreviewError(false); setPreviewWeekInvalid(false);
    try {
      const data = await readComplianceResponse(await fetch("/api/vs-performance/policy-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: patch, weekEnding: requestedWeek }) }), tp("previewFailed"));
      if (!previewRequests.current.current(version)) return;
      if (!isPolicyPreview(data) || data.weekEnding !== requestedWeek) throw new Error(tp("previewFailed"));
      setPreview({ key, response: data as VsPolicyPreviewResponse });
    } catch { if (previewRequests.current.current(version)) setPreviewError(true); }
    finally { if (previewRequests.current.current(version)) setPreviewBusy(false); }
  }

  const minimumWeek = settings?.latest && settings.latest.effectiveWeek > earliestWeek ? settings.latest.effectiveWeek : earliestWeek;
  const stalePreview = preview !== null && preview.key !== previewKey;
  const policyDetails = (policy: VsPolicyVersion) => <article key={policy.version} className="space-y-2 rounded border border-hq-border p-4" data-testid="vs-policy-history-row">
    <h3 className="font-medium">{tp(policy.modelVersion === 2 ? "dailyVersion" : "legacyVersion")} · {all("videoReview.vsWeeklyDateOption", { date: date(policy.effectiveWeek) })} · {all("shell.version", { version: number(policy.version) })}</h3>
    <label className="flex items-center gap-2"><input type="checkbox" checked={policy.enabled} disabled readOnly />{policy.modelVersion === 2 ? tp("enabled") : t("enabled")}</label>
    <p>{tp("dailyMinimum")}: {number(policy.dailyTarget)}</p>
    <p>{t("leeway")}: {number(policy.leewayPct)}</p>
    {policy.modelVersion === 2 ? <>
      <p>{tp("allowedMisses")}: {number(policy.allowedMissedDays)}</p>
      <p>{tp("demotionSequence")}: {number(policy.demotion.length)} {tp(policy.demotion.unit)}</p>
      <p>{tp("promotionSequence")}: {number(policy.promotion.length)} {tp(policy.promotion.unit)}</p>
    </> : <>
      <p>{t("weeklyMinimum")}: {number(policy.weeklyMinimum)}</p>
      <p>{t("preset")}: {t(policy.preset === "rank_aware" ? "rankAware" : "consecutive")}</p>
      {policy.preset === "consecutive" ? <p>{t("removalThreshold")}: {number(policy.removalThreshold)}</p> : null}
    </>}
  </article>;

  return <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
    <header className="space-y-2"><Link href="/vs-performance" className="text-hq-accent underline">{all("nav.vsPerformance")}</Link><h1 className="text-2xl font-semibold">{tp("title")}</h1><p>{allianceTag}</p></header>
    {loading ? <p role="status">{all("common.loading")}</p> : null}
    {draft && settings ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!settings.canManage || busy || loading} className="space-y-4">
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{tp("enabled")}</label>
        {!draft.enabled ? <p className="text-sm text-hq-fg-muted">{tp("disabledHint")}</p> : null}
        <label className="block space-y-2">{tp("dailyMinimum")}<input required type="number" min={1} step={1} value={draft.dailyTarget} onChange={(event) => setDraft({ ...draft, dailyTarget: event.target.value })} className={inputClass} /></label>
        {effectiveMinimum !== null ? <p className="text-sm text-hq-fg-muted">{tp("effectiveMinimum", { minimum: number(effectiveMinimum) })}</p> : null}
        <p className="text-sm text-hq-fg-muted">{tp("consistencyHint")}</p>
        <label className="block space-y-2">{t("leeway")}<input required type="number" min={0} max={100} step={1} value={draft.leewayPct} onChange={(event) => setDraft({ ...draft, leewayPct: event.target.value })} className={inputClass} /></label>
        <label className="block space-y-2">{tp("allowedMisses")}<input required type="number" min={0} max={5} step={1} value={draft.allowedMissedDays} onChange={(event) => setDraft({ ...draft, allowedMissedDays: event.target.value })} className={inputClass} /></label>
        <p className="text-sm text-hq-fg-muted">{tp("excusalHint")}</p>
        <fieldset className="space-y-2"><legend className="font-medium">{tp("demotionSequence")}</legend>
          <label className="block space-y-2">{tp("demotionLength")}<input required type="number" min={1} step={1} value={draft.demotionLength} onChange={(event) => setDraft({ ...draft, demotionLength: event.target.value })} className={inputClass} /></label>
          {sequenceSelect(draft.demotionUnit, (unit) => setDraft({ ...draft, demotionUnit: unit }), tp("demotionSequence"), tp)}
        </fieldset>
        <fieldset className="space-y-2"><legend className="font-medium">{tp("promotionSequence")}</legend>
          <label className="block space-y-2">{tp("promotionLength")}<input required type="number" min={1} step={1} value={draft.promotionLength} onChange={(event) => setDraft({ ...draft, promotionLength: event.target.value })} className={inputClass} /></label>
          {sequenceSelect(draft.promotionUnit, (unit) => setDraft({ ...draft, promotionUnit: unit }), tp("promotionSequence"), tp)}
        </fieldset>
        <label className="block space-y-2">{tp("effectiveWeek")}<input required type="date" min={minimumWeek} step={7} value={draft.effectiveWeek} onChange={(event) => setDraft({ ...draft, effectiveWeek: event.target.value })} className={inputClass} /></label>
        <p className="text-sm">{all("videoReview.vsWeeklyDateOption", { date: date(draft.effectiveWeek || minimumWeek) })}</p>
        <p className="text-sm text-hq-fg-muted">{tp("futureHint")}</p>
        <p className="text-sm text-hq-fg-muted">{tp("weekEndHint")}</p>
      </fieldset>
      {error ? <p ref={errorRef} role="alert" className="text-hq-danger">{error}</p> : null}
      {saved ? <p role="status">{t("saved")}</p> : null}
      {settings.canManage ? <button type="submit" disabled={busy || loading} className={buttonClass}>{busy ? all("common.loading") : all("commandersIndex.save")}</button> : null}
    </form> : error ? <p ref={errorRef} role="alert" className="text-hq-danger">{error}</p> : null}

    {settings?.canManage ? <section className="space-y-3" data-testid="vs-policy-preview">
      <h2 className="text-lg font-semibold">{tp("preview")}</h2>
      <label className="block space-y-2">{tp("previewWeek")}<input type="date" max={lastClosedVsWeek()} step={7} value={previewWeek} onChange={(event) => { setPreviewWeek(event.target.value); setPreviewWeekInvalid(false); }} className={inputClass} /></label>
      {previewWeekInvalid ? <p role="alert" className="text-hq-danger">{tp("closedWeek")}</p> : null}
      <p className="text-sm text-hq-fg-muted">{tp("previewHint")}</p>
      <button type="button" disabled={previewBusy || loading || !patch} className={buttonClass} onClick={() => void runPreview()}>{previewBusy ? all("common.loading") : tp("preview")}</button>
      {previewError ? <p role="alert" className="text-hq-danger">{tp("previewFailed")}</p> : null}
      {preview && !stalePreview ? <div className="space-y-2" data-testid="vs-policy-preview-results">
        <h3 className="font-medium">{tp("previewResults", { date: date(preview.response.weekEnding) })}</h3>
        {vsPreviewIncomplete(preview.response.rows) ? <p role="status" className="text-hq-fg-muted">{tp("previewIncomplete")}</p> : null}
        {preview.response.rows.length === 0 ? <p className="text-hq-fg-muted">{tp("previewEmpty")}</p> : null}
        <ul className="space-y-1">
          {preview.response.rows.map((row: VsPolicyPreviewRow) => <li key={row.memberId} className="rounded border border-hq-border p-2 text-sm">
            {row.memberName} · {tMembers(VS_PREVIEW_OUTCOME_KEYS[row.outcome])}
            {row.recommendationKind === "demote" && row.recommendationTargetRank !== null ? ` · ${t("demote", { rank: tMembers("rankLabel", { rank: row.recommendationTargetRank }) })}` : row.recommendationKind === "remove" ? ` · ${t("remove")}` : row.recommendationKind === "leadership_review" ? ` · ${t("leadershipReview")}` : null}
          </li>)}
        </ul>
      </div> : null}
    </section> : null}

    <button type="button" disabled={busy || loading} className={buttonClass} onClick={() => void load()}>{all("timeOff.unexpectedReport.refresh")}</button>
    {settings?.history.length ? <section className="space-y-3"><h2 className="text-lg font-semibold">{tp("history")}</h2>{settings.history.map(policyDetails)}</section> : null}
  </div>;
}
