"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";

type Props = {
  open: boolean;
  uploadHref: string;
  onCancel: () => void;
  onContinue: () => void;
};

export function EconomyWeekScoresOptionalDialog({
  open,
  uploadHref,
  onCancel,
  onContinue,
}: Props) {
  const t = useTranslations("trains.economyScoresOptional");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t("body")}
      data-testid="trains-economy-scores-optional-confirm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-hq-fg">{t("body")}</p>
        <Link
          href={uploadHref}
          className="text-sm font-medium text-cyan-300 hover:text-cyan-200"
        >
          {t("uploadLink")}
        </Link>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-surface"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0]"
          >
            {t("continue")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
