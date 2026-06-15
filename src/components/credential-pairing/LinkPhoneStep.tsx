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
      <p className="text-sm text-[#8b949e]">{t("intro")}</p>
      <p className="text-sm text-[#8b949e]">{t("privacyNote")}</p>

      {phase === "linked" ? (
        <div className="rounded-lg border border-[#238636]/40 bg-[#238636]/10 px-4 py-3">
          <p className="font-medium text-[#3fb950]">{t("linkedTitle")}</p>
          <p className="mt-2 text-sm text-[#8b949e]">{t("linkedBody")}</p>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="space-y-3 rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 px-4 py-3">
          <p className="font-medium text-[#f85149]">{t("errorTitle")}</p>
          <p className="text-sm text-[#8b949e]">{t("errorBody")}</p>
          <button
            type="button"
            onClick={() => dispatch("retry")}
            className="rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#30363d]"
          >
            {t("tryAgain")}
          </button>
        </div>
      ) : null}

      {phase === "idle" ? (
        <button
          type="button"
          onClick={() => dispatch("reveal")}
          className="w-full rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#30363d] sm:w-auto"
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
