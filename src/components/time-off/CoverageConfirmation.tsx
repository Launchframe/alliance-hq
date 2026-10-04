"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import type { CoverageAcceptance, CoverageConflict } from "@/lib/time-off/coverage.shared";

export function CoverageDescription({ conflict }: { conflict: CoverageConflict }) {
  const t = useTranslations("teamWork");
  const trains = useTranslations("trains.conductorHistory");
  const professions = useTranslations("videoReview.rosterProfession");
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${conflict.dutyDate}T12:00:00Z`));
  const shiftFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: SERVER_TIME_IANA });
  return <div><p>{t("coverageConflict", { member: conflict.memberName, duty: conflict.dutyRole === "engineer" ? professions("engineer") : trains(conflict.dutyRole), date })}</p>
    {conflict.dutyStartAt && conflict.dutyEndAt ? <p>{shiftFormat.formatRange(new Date(conflict.dutyStartAt), new Date(conflict.dutyEndAt))}</p> : null}
  </div>;
}

export function useCoverageFetch() {
  const t = useTranslations("teamWork");
  const timeOff = useTranslations("timeOff.workflow");
  const [conflicts, setConflicts] = useState<CoverageConflict[] | null>(null);
  const [note, setNote] = useState("");
  const pending = useRef<((acceptance: CoverageAcceptance | null) => void) | null>(null);
  const finish = useCallback((acceptance: CoverageAcceptance | null) => {
    pending.current?.(acceptance);
    pending.current = null;
    setConflicts(null);
  }, []);
  const coverageFetch = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    let response = await fetch(url, init);
    let reviewed: CoverageConflict[] = [];
    while (response.status === 409) {
      const data = await response.clone().json().catch(() => null);
      if (data?.code !== "coverage_conflict" || !data.conflicts?.length || pending.current) return response;
      const current = data.conflicts as CoverageConflict[];
      reviewed = [...reviewed.filter((old) => !current.some((next) => next.assignmentId === old.assignmentId && next.dutyRole === old.dutyRole)), ...current];
      setNote("");
      setConflicts(reviewed);
      const acceptance = await new Promise<CoverageAcceptance | null>((resolve) => { pending.current = resolve; });
      if (!acceptance) return response;
      response = await fetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(String(init?.body ?? "{}")), coverage: acceptance }) });
    }
    return response;
  }, []);
  const coverageDialog = <Dialog zIndex={300} open={conflicts !== null} onOpenChange={(open) => { if (!open) finish(null); }} title={t("keep")} data-testid="coverage-confirmation">
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">{t("keep")}</h2>
      {conflicts?.map((conflict) => <CoverageDescription key={`${conflict.assignmentId}:${conflict.dutyRole}:${conflict.dutyDate}:${conflict.dutyStartAt ?? ""}`} conflict={conflict} />)}
      <p>{t("keepHint")}</p>
      <label className="block">{t("auditReason")}<textarea className="mt-2 w-full rounded border border-hq-border bg-hq-surface p-2" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="flex gap-3">
        <button type="button" onClick={() => finish(null)}>{timeOff("back")}</button>
        <button type="button" disabled={!note.trim()} onClick={() => finish({ conflicts: conflicts ?? [], note, requestId: crypto.randomUUID() })}>{t("keep")}</button>
      </div>
    </div>
  </Dialog>;
  return { coverageFetch, coverageDialog };
}
