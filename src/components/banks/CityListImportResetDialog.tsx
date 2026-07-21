"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CityListImportResetDialog({
  open,
  onConfirm,
  onCancel,
}: Props) {
  const t = useTranslations("bankManagement");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t("cityListResetTitle")}
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-hq-fg">
          {t("cityListResetTitle")}
        </h2>
        <p className="text-sm text-hq-fg-muted">{t("cityListResetBody")}</p>
        <p className="text-xs text-hq-fg-muted">{t("cityListResetHint")}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("actions.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            data-testid="city-list-import-reset-confirm"
          >
            {t("cityListResetConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
