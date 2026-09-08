"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { CoverageConflict, CoverageRouting } from "@/lib/time-off/coverage.shared";
import { CoverageDescription, useCoverageFetch } from "./CoverageConfirmation";
import { TimeClockPicker } from "@/components/professions/TimeClockPicker";

function ProfessionWindowEditor({ conflict, onSaved }: { conflict: CoverageConflict; onSaved: () => Promise<void> }) {
  const t = useTranslations("professions");
  const work = useTranslations("teamWork");
  const [start, setStart] = useState<number | null>(conflict.coverageStartHour ?? null);
  const [end, setEnd] = useState<number | null>(conflict.coverageEndHour ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { coverageFetch, coverageDialog } = useCoverageFetch();
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await coverageFetch("/api/professions/coverage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId: conflict.assignmentId, coverageStartHour: start, coverageEndHour: end }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("saveCoverageFailed"));
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("saveCoverageFailed")); }
    finally { setBusy(false); }
  }
  return <details><summary>{work("reassign")}</summary>
    <p>{t("coverageWindow")} · {t("serverTime")}</p>
    <TimeClockPicker label={t("coverageStartHour")} utcHour={start} zone="server" onChange={setStart} />
    <TimeClockPicker label={t("coverageEndHour")} utcHour={end} zone="server" onChange={setEnd} />
    <button type="button" disabled={busy || start === null || end === null} onClick={() => void save()}>{t("saveCoverage")}</button>
    {error ? <p role="alert">{error}</p> : null}
    {coverageDialog}
  </details>;
}

export function CoveragePanel({ refreshKey }: { refreshKey?: string }) {
  const t = useTranslations("teamWork");
  const timeOff = useTranslations("timeOff.workflow");
  const [conflicts, setConflicts] = useState<Array<CoverageConflict & { routing?: CoverageRouting | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedDuty, setFailedDuty] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const { coverageFetch, coverageDialog } = useCoverageFetch();
  const load = useCallback(async () => {
    const response = await fetch("/api/time-off/coverage");
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error ?? timeOff("errors.loadFailed"));
    return data.conflicts;
  }, [timeOff]);
  useEffect(() => { let active = true; void load().then((rows) => { if (active) setConflicts(rows); }).catch((cause) => { if (active) setError(cause.message); }); return () => { active = false; }; }, [load, refreshKey]);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  async function keep(conflict: CoverageConflict) {
    setBusy(true);
    setError(null);
    setFailedDuty(conflict.assignmentId);
    try {
      const response = await coverageFetch("/api/time-off/coverage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coverage: { conflicts: [conflict], note: "", requestId: crypto.randomUUID() } }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? timeOff("errors.saveFailed"));
      setConflicts(await load());
    } catch (cause) { setError(cause instanceof Error ? cause.message : timeOff("errors.saveFailed")); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border border-hq-border p-4" data-testid="coverage-panel">
    <h2 className="text-lg font-semibold">{t("title")}</h2>
    {!conflicts.length && !error ? <p>{t("empty")}</p> : null}
    {conflicts.map((conflict) => <article className="space-y-2 border-b border-hq-border py-3" key={`${conflict.assignmentId}:${conflict.assignmentVersion}:${conflict.dutyRole}:${conflict.dutyDate}:${conflict.dutyStartAt ?? ""}`}>
      <CoverageDescription conflict={conflict} />
      {conflict.routing ? <p>{t("assignedTo", { name: conflict.routing.name })}</p> : null}
      <div className="flex gap-4">
        {conflict.dutyRole === "engineer" ? <ProfessionWindowEditor conflict={conflict} onSaved={async () => setConflicts(await load())} /> : <Link href={`/trains?date=${conflict.dutyDate}`}>{t("reassign")}</Link>}
        <button type="button" disabled={busy} onClick={() => void keep(conflict)}>{t("keep")}</button>
      </div>
      {error && failedDuty === conflict.assignmentId ? <p ref={errorRef} role="alert">{error}</p> : null}
    </article>)}
    {error && !failedDuty ? <p ref={errorRef} role="alert">{error}</p> : null}
    {coverageDialog}
  </section>;
}
