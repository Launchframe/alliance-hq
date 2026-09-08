"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { CoverageConflict, CoverageRouting } from "@/lib/time-off/coverage.shared";
import { CoverageDescription, useCoverageFetch } from "./CoverageConfirmation";

export function CoveragePanel({ refreshKey, memberIds, onResolved }: { refreshKey?: string; memberIds?: string[]; onResolved?: () => void }) {
  const memberFilter = memberIds ? JSON.stringify([...new Set(memberIds)].sort()) : null;
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
    return memberFilter ? data.conflicts.filter((conflict: CoverageConflict) => (JSON.parse(memberFilter) as string[]).includes(conflict.memberId)) : data.conflicts;
  }, [timeOff, memberFilter]);
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
      onResolved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : timeOff("errors.saveFailed")); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border border-hq-border p-4" data-testid="coverage-panel">
    <h2 className="text-lg font-semibold">{t("title")}</h2>
    {!conflicts.length && !error ? <p>{t("empty")}</p> : null}
    {conflicts.map((conflict) => <article className="space-y-2 border-b border-hq-border py-3" key={`${conflict.assignmentId}:${conflict.dutyRole}`}>
      <CoverageDescription conflict={conflict} />
      {conflict.routing ? <p>{t("assignedTo", { name: conflict.routing.name })}</p> : null}
      <div className="flex gap-4">
        <Link href={conflict.dutyRole === "engineer" ? "/professions/officer" : `/trains?date=${conflict.dutyDate}`}>{t("reassign")}</Link>
        <button type="button" disabled={busy} onClick={() => void keep(conflict)}>{t("keep")}</button>
      </div>
      {error && failedDuty === conflict.assignmentId ? <p ref={errorRef} role="alert">{error}</p> : null}
    </article>)}
    {error && !failedDuty ? <p ref={errorRef} role="alert">{error}</p> : null}
    {coverageDialog}
  </section>;
}
