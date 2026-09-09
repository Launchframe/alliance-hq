"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTimeZone, useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import {
  timeOffSyncErrorKey,
  timeOffSyncReviewSchema,
  timeOffSyncStatusKey,
  type TimeOffSyncBinding,
  type TimeOffSyncReview,
  type TimeOffSyncStatus,
} from "./sync-ui.shared";

const buttonClassName = "rounded border border-hq-border px-3 py-2 text-sm text-hq-fg disabled:opacity-50";

type Props = {
  entryId: string;
  version: number;
  status: TimeOffSyncStatus;
  lastSyncedAt?: string | null;
  canManage: boolean;
  onChanged: () => void;
};

type ReviewAction = "keep_hq" | "use_ashed" | "link_existing";
type Confirmation = { bindingId: string; action: "keep_hq" | "use_ashed" };
type ActionError = { bindingId?: string; key: ReturnType<typeof timeOffSyncErrorKey> };

export function TimeOffSyncPanel(props: Props) {
  return <SyncPanel key={`${props.entryId}:${props.version}:${props.status}`} {...props} />;
}

function SyncPanel({ entryId, version, status, lastSyncedAt, canManage, onChanged }: Props) {
  const t = useTranslations("timeOff");
  const locale = useLocale();
  const timeZone = useTimeZone() ?? "UTC";
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<TimeOffSyncReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<"sync.retryQueued" | "sync.resolved" | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);

  const url = `/api/time-off/entries/${encodeURIComponent(entryId)}/sync`;
  const canReview = canManage && (status === "conflict" || status === "uncertain");
  const canRetry = canManage && (status === "failed" || status === "credentials_required" || status === "pending" || status === "cancel_pending");
  const syncedDate = lastSyncedAt ? new Date(lastSyncedAt) : null;
  const formatDate = (date: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const formatTime = (date: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(date));
  const periodLabel = (period: { startDate: string; endDate: string; recordType: "vs" | "donation" }) =>
    `${t(`sync.scope.${period.recordType}`)} · ${t("entry.range", { start: formatDate(period.startDate), end: formatDate(period.endDate) })}`;

  async function loadReview() {
    if (!canReview || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setOpen(true);
    setError(null);
    setNotice(null);
    setReview(null);
    setConfirmation(null);
    setSelected({});
    try {
      const response = await fetch(url, { cache: "no-store" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError({ key: timeOffSyncErrorKey(data, response.status) });
        return;
      }
      const parsed = timeOffSyncReviewSchema.safeParse(data);
      if (!parsed.success) {
        setError({ key: "sync.actionFailed" });
        return;
      }
      setReview(parsed.data);
    } catch {
      setError({ key: "sync.actionFailed" });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function act(action: "retry" | ReviewAction, binding?: TimeOffSyncBinding) {
    if (!canManage || submitting.current || (action === "retry" ? !canRetry : !binding || !review)) return;
    if ((action === "keep_hq" || action === "use_ashed") && (confirmation?.bindingId !== binding?.id || confirmation?.action !== action)) return;
    const remoteId = binding ? selected[binding.id] : undefined;
    if (action === "link_existing" && !binding?.candidates.some((candidate) => candidate.id === remoteId)) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          version: action === "retry" ? version : review?.version,
          ...(binding ? { bindingId: binding.id, fingerprint: binding.fingerprint } : {}),
          ...(action === "link_existing" ? { remoteId, candidateFingerprint: binding?.candidates.find((candidate) => candidate.id === remoteId)?.fingerprint } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError({ bindingId: binding?.id, key: timeOffSyncErrorKey(data, response.status) });
        return;
      }
      if (data?.ok !== true) {
        setError({ bindingId: binding?.id, key: "sync.actionFailed" });
        return;
      }
      setNotice(action === "retry" || action === "keep_hq" ? "sync.retryQueued" : "sync.resolved");
      setOpen(false);
      setReview(null);
      setConfirmation(null);
      onChanged();
    } catch {
      setError({ bindingId: binding?.id, key: "sync.actionFailed" });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const errorMessage = error ? <p ref={errorRef} role="alert" className="text-sm text-rose-700 dark:text-rose-300">{t(error.key)}</p> : null;

  return (
    <section aria-label={t("sync.title")} className="space-y-2 rounded border border-hq-border bg-hq-surface-muted p-3">
      <p className="text-xs font-semibold text-hq-fg-muted">{t("sync.title")}</p>
      <p role="status" className="text-sm text-hq-fg"><span className="inline-block rounded border border-hq-border px-2 py-1">{t(timeOffSyncStatusKey(status))}</span></p>
      {status !== "local" && syncedDate && Number.isFinite(syncedDate.getTime()) ? (
        <p className="text-xs text-hq-fg-muted">{t("sync.lastSynced", { date: formatTime(lastSyncedAt!) })}</p>
      ) : null}
      {canRetry || canReview ? (
        <div className="flex flex-wrap gap-2">
          {canRetry ? <button type="button" className={buttonClassName} disabled={busy} onClick={() => void act("retry")}>{busy ? t("workflow.loading") : t("sync.retry")}</button> : null}
          {canReview ? <button type="button" className={buttonClassName} disabled={busy} onClick={() => void loadReview()}>{t("sync.reviewConflict")}</button> : null}
        </div>
      ) : null}
      {!open ? errorMessage : null}
      {notice ? <p role="status" className="text-sm text-hq-fg">{t(notice)}</p> : null}
      <Dialog open={open && canReview} onOpenChange={(next) => { if (!next && !busy) setOpen(false); }} title={t("sync.reviewConflict")} className="max-w-lg">
        <h2 className="text-lg font-semibold text-hq-fg">{t("sync.reviewConflict")}</h2>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("workflow.serverTime")}</p>
        <div className="mt-4 space-y-4" aria-busy={busy}>
          {busy && !review ? <p role="status" className="text-sm">{t("workflow.loading")}</p> : null}
          {review?.bindings.length === 0 ? <p className="text-sm">{t("workflow.noMatches")}</p> : null}
          {review?.bindings.map((binding) => {
            const confirming = confirmation?.bindingId === binding.id ? confirmation : null;
            return (
              <section key={binding.id} className="space-y-3 rounded border border-hq-border bg-hq-surface-muted p-3">
                <h3 className="font-semibold text-hq-fg">{t(`sync.scope.${binding.recordType}`)}</h3>
                <p className="text-sm">{t(timeOffSyncStatusKey(binding.status))}</p>
                {binding.remote ? <p className="text-sm">{periodLabel(binding.remote)}</p> : null}
                {binding.status === "uncertain" ? (
                  <>
                    <p className="text-sm text-hq-fg-muted">{t("sync.linkExistingHint")}</p>
                    <label className="block text-sm">
                      {t("workflow.chooseEntry")}
                      <select value={selected[binding.id] ?? ""} disabled={busy || binding.candidates.length === 0}
                        onChange={(event) => setSelected((current) => ({ ...current, [binding.id]: event.target.value }))}
                        className="mt-1 w-full rounded border border-hq-border bg-hq-surface px-2 py-2 text-sm text-hq-fg">
                        <option value="">{t(binding.candidates.length ? "workflow.chooseEntry" : "workflow.noMatches")}</option>
                        {binding.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{periodLabel(candidate)}{candidate.createdAt ? ` · ${formatTime(candidate.createdAt)}` : ""}</option>)}
                      </select>
                    </label>
                    <button type="button" disabled={busy || !selected[binding.id]} className={buttonClassName} onClick={() => void act("link_existing", binding)}>{t("sync.linkExisting")}</button>
                  </>
                ) : binding.status === "conflict" ? (
                  confirming ? (
                    <div className="space-y-2">
                      <p className="text-sm">{t(confirming.action === "keep_hq" ? "sync.confirmKeepHq" : "sync.confirmUseAshed")}</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} className={buttonClassName} onClick={() => setConfirmation(null)}>{t("workflow.back")}</button>
                        <button type="button" disabled={busy} className={buttonClassName} onClick={() => void act(confirming.action, binding)}>{busy ? t("workflow.loading") : t(confirming.action === "keep_hq" ? "sync.keepHq" : "sync.useAshed")}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} className={buttonClassName} onClick={() => setConfirmation({ bindingId: binding.id, action: "keep_hq" })}>{t("sync.keepHq")}</button>
                      <button type="button" disabled={busy} className={buttonClassName} onClick={() => setConfirmation({ bindingId: binding.id, action: "use_ashed" })}>{t("sync.useAshed")}</button>
                    </div>
                  )
                ) : null}
                {error?.bindingId === binding.id ? errorMessage : null}
              </section>
            );
          })}
          {error && !error.bindingId ? errorMessage : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} className={buttonClassName} onClick={() => setOpen(false)}>{t("officerModal.cancel")}</button>
            <button type="button" disabled={busy} className={buttonClassName} onClick={() => void loadReview()}>{t("sync.reviewConflict")}</button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
