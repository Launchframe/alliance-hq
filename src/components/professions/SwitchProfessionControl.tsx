"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Profession } from "@/lib/professions/types";

type Props = {
  currentProfession: Profession;
  onSwitched: () => void;
  icon?: ReactNode;
};

export function SwitchProfessionControl({
  currentProfession,
  onSwitched,
  icon,
}: Props) {
  const t = useTranslations("professions");
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toProfession: Profession =
    currentProfession === "Engineer" ? "War Leader" : "Engineer";

  async function confirmSwitch() {
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch("/api/professions/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toProfession }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? t("switchFailed"));
        return;
      }
      setOpen(false);
      onSwitched();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {icon ? <span className="mr-1.5 inline-flex">{icon}</span> : null}
        {t("switchProfession")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!switching) setOpen(next);
        }}
        title={t("switchProfessionConfirmTitle")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-hq-fg-muted">
            {t("switchProfessionConfirmBody", {
              from: currentProfession,
              to: toProfession,
            })}
          </p>
          <p className="text-sm text-hq-fg-muted">
            {toProfession === "Engineer"
              ? t("switchConsequencesToEng")
              : t("switchConsequencesToWl")}
          </p>
          {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={switching}
              onClick={() => setOpen(false)}
            >
              {t("switchCancel")}
            </Button>
            <Button
              size="sm"
              disabled={switching}
              onClick={() => void confirmSwitch()}
            >
              {switching
                ? t("switching")
                : t("switchConfirm", { to: toProfession })}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
