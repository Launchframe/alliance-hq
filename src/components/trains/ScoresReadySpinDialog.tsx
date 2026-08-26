"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onDismiss: () => void;
  onSpin: () => void;
};

export function ScoresReadySpinDialog({ open, onDismiss, onSpin }: Props) {
  const t = useTranslations("trains.scoresReady");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      title={t("body")}
      data-testid="trains-scores-ready-prompt"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-hq-fg">{t("body")}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface"
          >
            {t("dismiss")}
          </button>
          <button
            type="button"
            onClick={onSpin}
            className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-hq-selected-fg hover:opacity-90"
          >
            {t("spin")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
