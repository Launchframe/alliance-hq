"use client";

import { useCallback, useReducer } from "react";
import { useTranslations } from "next-intl";

import {
  PairingQrWizard,
  type PairingWizardStrings,
} from "@/components/credential-pairing/PairingQrWizard";
import {
  reduceLinkPhonePhase,
  type LinkPhonePhase,
  type LinkPhonePhaseEvent,
} from "@/lib/credential-pairing/link-phone-phase";

type Props = {
  onLinked?: () => void;
};

export function LinkPhoneStep({ onLinked }: Props) {
  const t = useTranslations("connect.steps.linkPhone");
  const tDevice = useTranslations("deviceLink");
  const [phase, dispatch] = useReducer(
    (state: LinkPhonePhase, event: LinkPhonePhaseEvent) =>
      reduceLinkPhonePhase(state, event),
    "idle" satisfies LinkPhonePhase,
  );

  const wizardStrings: PairingWizardStrings = {
    showQr: t("revealQr"),
    generating: tDevice("generating"),
    scanHint: tDevice("scanHint"),
    expiresIn: tDevice("expiresIn"),
    expired: tDevice("expired"),
    linked: tDevice("linked"),
    createFailed: tDevice("createFailed"),
    hideQr: t("hideQr"),
  };

  const handleLinked = useCallback(() => {
    dispatch("linked");
    onLinked?.();
  }, [onLinked]);

  const handleError = useCallback(() => {
    dispatch("error");
  }, []);

  const handleHide = useCallback(() => {
    dispatch("hide");
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-hq-fg-muted">{t("intro")}</p>
      <p className="text-sm text-hq-fg-muted">{t("privacyNote")}</p>

      {phase === "linked" ? (
        <div className="rounded-lg border border-hq-success/40 bg-hq-success/10 px-4 py-3">
          <p className="font-medium text-hq-green">{t("linkedTitle")}</p>
          <p className="mt-2 text-sm text-hq-fg-muted">{t("linkedBody")}</p>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="space-y-3 rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-4 py-3">
          <p className="font-medium text-hq-danger">{t("errorTitle")}</p>
          <p className="text-sm text-hq-fg-muted">{t("errorBody")}</p>
          <button
            type="button"
            onClick={() => dispatch("retry")}
            className="rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm text-hq-fg hover:bg-hq-border"
          >
            {t("tryAgain")}
          </button>
        </div>
      ) : null}

      {phase === "idle" ? (
        <button
          type="button"
          onClick={() => dispatch("reveal")}
          className="w-full rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-border sm:w-auto"
        >
          {t("revealQr")}
        </button>
      ) : null}

      {phase === "showing" ? (
        <PairingQrWizard
          purpose="device_link"
          autoStart
          onLinked={handleLinked}
          onError={handleError}
          onHide={handleHide}
          strings={wizardStrings}
        />
      ) : null}
    </div>
  );
}
