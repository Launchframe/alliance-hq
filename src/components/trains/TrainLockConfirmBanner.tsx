"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type TrainLockConfirmBannerProps = {
  message: string;
  hint?: string;
  announcementText: string;
  announcementPreviewLabel: string;
  cancelLabel: string;
  confirmAnnounceLabel: string;
  lockOnlyLabel: string;
  copyAnnouncementLabel: string;
  copiedAnnouncementLabel: string;
  copyFailedLabel: string;
  confirmingLabel: string;
  confirming?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirmAnnounce: () => void;
  onConfirmLockOnly: () => void;
};

export function TrainLockConfirmBanner({
  message,
  hint,
  announcementText,
  announcementPreviewLabel,
  cancelLabel,
  confirmAnnounceLabel,
  lockOnlyLabel,
  copyAnnouncementLabel,
  copiedAnnouncementLabel,
  copyFailedLabel,
  confirmingLabel,
  confirming = false,
  busy = false,
  onCancel,
  onConfirmAnnounce,
  onConfirmLockOnly,
}: TrainLockConfirmBannerProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function handleCopyAnnouncement() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(announcementText);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div
      className="flex w-full flex-col gap-3 rounded-lg border border-hq-success/40 bg-hq-success/10 px-3 py-3"
      data-testid="trains-lock-confirm-banner"
      role="status"
    >
      <div className="space-y-1">
        <p className="text-sm text-hq-green">{message}</p>
        {hint ? <p className="text-xs text-hq-fg-muted">{hint}</p> : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-hq-fg-muted">
          {announcementPreviewLabel}
        </p>
        <div className="flex min-w-0 items-start gap-2 rounded-lg border border-hq-border bg-hq-canvas p-2">
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-hq-fg">
            {announcementText}
          </p>
          <button
            type="button"
            onClick={() => void handleCopyAnnouncement()}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hq-border px-2 py-1 text-xs text-hq-fg hover:bg-hq-surface"
          >
            {copied ? (
              <>
                <Check className="size-3.5" aria-hidden />
                {copiedAnnouncementLabel}
              </>
            ) : (
              <>
                <Copy className="size-3.5" aria-hidden />
                {copyAnnouncementLabel}
              </>
            )}
          </button>
        </div>
        {copyFailed ? (
          <p className="text-xs text-hq-danger" role="alert">
            {copyFailedLabel}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-canvas"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirmLockOnly}
          className="rounded-md border border-hq-success/50 bg-hq-canvas px-3 py-1.5 text-xs font-medium text-hq-green hover:bg-hq-success/10 disabled:opacity-50"
        >
          {confirming ? confirmingLabel : lockOnlyLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirmAnnounce}
          className="rounded-md bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
        >
          {confirming ? confirmingLabel : confirmAnnounceLabel}
        </button>
      </div>
    </div>
  );
}
