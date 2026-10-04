"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PaintRuleConductorBlocker } from "@/lib/trains/paint-rule-conductor-gate.shared";

type Props = {
  open: boolean;
  kind: "clear" | "request_unlock";
  blockers: PaintRuleConductorBlocker[];
  ruleLabel: string;
  busy?: boolean;
  onConfirmClear: () => void;
  onRequestUnlock: () => void;
  onCancel: () => void;
};

function blockerNames(blockers: PaintRuleConductorBlocker[]): string {
  return blockers.map((row) => row.conductorName).join(", ");
}

export function PaintRuleConductorGateDialog({
  open,
  kind,
  blockers,
  ruleLabel,
  busy = false,
  onConfirmClear,
  onRequestUnlock,
  onCancel,
}: Props) {
  const t = useTranslations("trains.paintRuleGate");
  const [copied, setCopied] = useState(false);
  const name = blockerNames(blockers);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      title={t("ineligibleLocked", { name, rule: ruleLabel })}
      data-testid="trains-paint-rule-gate"
    >
      <div className="space-y-4">
        <p className="text-sm text-hq-fg">
          {kind === "clear"
            ? t("ineligibleClear", { name, rule: ruleLabel })
            : t("ineligibleLocked", { name, rule: ruleLabel })}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
            data-testid="trains-paint-rule-gate-no"
          >
            {t("no")}
          </Button>
          {kind === "clear" ? (
            <Button
              type="button"
              disabled={busy}
              onClick={onConfirmClear}
              data-testid="trains-paint-rule-gate-yes"
            >
              {t("yes")}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setCopied(true);
                onRequestUnlock();
              }}
              data-testid="trains-paint-rule-gate-request-unlock"
            >
              {copied ? t("copied") : t("requestUnlockAction")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
