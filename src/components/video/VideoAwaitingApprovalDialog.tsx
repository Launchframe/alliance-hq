"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  fileName?: string | null;
  onDismiss: () => void;
};

export function VideoAwaitingApprovalDialog({
  open,
  fileName,
  onDismiss,
}: Props) {
  const t = useTranslations("video.awaitingApprovalDialog");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      title={t("title")}
      className="max-w-xl max-h-[min(96dvh,40rem)]"
      data-testid="video-awaiting-approval-dialog"
    >
      <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
      <p className="mt-2 text-sm text-hq-fg-muted">{t("body")}</p>
      {fileName ? (
        <p className="mt-3 break-all text-sm font-medium text-hq-fg">{fileName}</p>
      ) : null}
      <div className="mt-5">
        <button
          type="button"
          onClick={onDismiss}
          className="w-full rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg hover:border-hq-accent hover:text-hq-accent sm:w-auto"
        >
          {t("done")}
        </button>
      </div>
    </Dialog>
  );
}
