"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import { dispatchInboxRemindersRefresh } from "@/lib/inbox-reminders-refresh.shared";
import { ComplianceEvidence } from "./ComplianceEvidence";
import { actionBody, ComplianceClientError, createActionAttempt, readComplianceResponse, syncLabel, type ActionAttempt, type ComplianceRow } from "./client.shared";

const buttonClass = "rounded border border-hq-border px-3 py-2 text-sm disabled:opacity-50";

export function ConfirmationDialog({ row, operation, onClose, onSaved }: { row: ComplianceRow; operation: ActionAttempt["operation"]; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("vsCompliance");
  const all = useTranslations();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<unknown>(null);
  const attempt = useRef<ActionAttempt | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);

  async function submit() {
    if (inFlight.current || blocked) return;
    if (operation === "waive" && !reason.trim()) { setError(t("reasonRequired")); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    attempt.current ??= createActionAttempt(row, operation, reason);
    try {
      const response = await fetch(`/api/vs-compliance/tasks/${encodeURIComponent(row.id)}/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actionBody(attempt.current)) });
      const data = await readComplianceResponse(response, all("statSync.actionFailed"));
      if (data.ok !== true || typeof data.actionId !== "string") throw new ComplianceClientError(all("statSync.actionFailed"), "failed", true);
      setSaved(true);
      setUncertain(false);
      setStatus(data.syncStatus);
      dispatchInboxRemindersRefresh();
      onSaved();
    } catch (failure) {
      setError(failure instanceof ComplianceClientError ? failure.message : all("statSync.actionFailed"));
      const isUncertain = !(failure instanceof ComplianceClientError) || failure.uncertain;
      setUncertain(isUncertain);
      if (failure instanceof ComplianceClientError && ["changed", "handled", "forbidden", "not_found"].includes(failure.code)) setBlocked(true);
      if (!isUncertain && !saved) attempt.current = null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const close = () => { if (!busy && !uncertain) onClose(); };
  const retrySync = saved && operation === "complete" && !["local", "synced"].includes(String(status));
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }} ignoreOutsideDismiss title={t(operation === "waive" ? "waive" : "confirm")} className="max-w-xl">
    <div ref={panelRef} tabIndex={-1} className="space-y-4 p-5" onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const elements = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], summary');
      if (!elements?.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <h2 className="text-lg font-semibold">{t(operation === "waive" ? "waive" : "confirm")}</h2>
      <h3 className="font-medium">{row.memberName}</h3>
      <ComplianceEvidence row={row} />
      {operation === "complete" ? <p>{t("confirmHint")}</p> : <label className="block space-y-2">{t("waiverReason")}<textarea required maxLength={2000} disabled={busy || uncertain || saved || blocked} value={reason} onChange={(event) => { setReason(event.target.value); attempt.current = null; }} className="block w-full rounded border border-hq-border bg-hq-surface p-2" /></label>}
      {saved ? <div role="status" className="space-y-2"><p>{t(operation === "waive" ? "waived" : "actionSaved")}</p>{operation === "complete" ? <p>{all(`timeOff.sync.${syncLabel(status)}`)}</p> : null}</div> : null}
      {status === "credentials_required" || status === "failed" ? <Link href="/connect?next=/vs-compliance" className="text-hq-accent underline">{all("common.connect")}</Link> : null}
      {error ? <p ref={errorRef} role="alert" className="text-sm text-hq-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!saved || retrySync ? <button type="button" disabled={busy || blocked} className={buttonClass} onClick={() => void submit()}>{busy ? all("common.loading") : retrySync ? all("timeOff.sync.retry") : t(operation === "waive" ? "waive" : "confirm")}</button> : null}
        <button type="button" disabled={busy || uncertain} className={buttonClass} onClick={close}>{all("timeOff.officerModal.cancel")}</button>
      </div>
    </div>
  </Dialog>;
}
