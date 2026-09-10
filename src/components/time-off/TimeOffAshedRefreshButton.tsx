"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { timeOffSyncErrorKey } from "./sync-ui.shared";

type Props = {
  canManage: boolean;
  onChanged: () => void;
};

export function TimeOffAshedRefreshButton({ canManage, onChanged }: Props) {
  const t = useTranslations("timeOff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof timeOffSyncErrorKey> | null>(null);
  const [queued, setQueued] = useState(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);

  async function refresh() {
    if (!canManage || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setQueued(false);
    try {
      const response = await fetch("/api/time-off/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(timeOffSyncErrorKey(data, response.status));
        return;
      }
      if (data?.ok !== true) {
        setError("sync.actionFailed");
        return;
      }
      setQueued(true);
      onChanged();
    } catch {
      setError("sync.actionFailed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!canManage) return null;

  return (
    <div className="space-y-2">
      <button type="button" disabled={busy} onClick={() => void refresh()}
        className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg disabled:opacity-50">
        {busy ? t("workflow.loading") : t("sync.refresh")}
      </button>
      {error ? <p ref={errorRef} role="alert" className="text-sm text-rose-700 dark:text-rose-300">{t(error)}</p> : null}
      {queued ? <p role="status" className="text-sm text-hq-fg">{t("sync.refreshQueued")}</p> : null}
    </div>
  );
}
