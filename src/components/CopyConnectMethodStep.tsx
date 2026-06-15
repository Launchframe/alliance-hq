"use client";

import { useTranslations } from "next-intl";

import { ConnectStepScreenshot } from "@/components/ConnectStepScreenshot";
import {
  inlineCode,
  mutedText,
  smallCode,
  strongText,
} from "@/components/i18n/richText";

export type CopyConnectMethod = "curl" | "authorization";

type Props = {
  method: CopyConnectMethod;
  onMethodChange: (method: CopyConnectMethod) => void;
};

export function CopyConnectMethodStep({ method, onMethodChange }: Props) {
  const t = useTranslations("connect.copyMethod");

  if (method === "authorization") {
    return (
      <>
        <p className="text-sm text-[#8b949e]">
          {t.rich("authorizationIntro", {
            headers: strongText,
            code: smallCode,
          })}
        </p>
        <ConnectStepScreenshot
          src="/help/connect/3b-copy-authorization.png"
          alt={t("authorizationScreenshotAlt")}
          caption={t("authorizationScreenshotCaption")}
        />
        <pre className="overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-3 font-mono text-xs text-[#e6edf3]">
          {t("authorizationExample")}
        </pre>
        <p className="mt-4 text-sm">
          <button
            type="button"
            onClick={() => onMethodChange("curl")}
            className="text-[#58a6ff] hover:underline"
          >
            {t("tryCurlInstead")}
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <p className="rounded-lg border border-[#238636]/40 bg-[#238636]/10 px-3 py-2 text-sm">
        <strong className="text-[#3fb950]">{t("easiestMethodLabel")}</strong>{" "}
        {t("easiestMethodBody")}
      </p>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">
        <li>{t.rich("stepClickRequest", { code: inlineCode, strong: strongText })}</li>
        <li>
          {t.rich("stepCopyCurl", {
            strong: strongText,
            muted: mutedText,
          })}
        </li>
      </ol>
      <p className="mt-3 text-sm text-[#8b949e]">
        {t.rich("curlBashHint", { strong: strongText })}
      </p>
      <ConnectStepScreenshot
        src="/help/connect/3a-copy-as-curl.png"
        alt={t("curlScreenshotAlt")}
        caption={t("curlScreenshotCaption")}
      />
      <p className="mt-4 text-sm">
        <button
          type="button"
          onClick={() => onMethodChange("authorization")}
          className="text-[#58a6ff] hover:underline"
        >
          {t("alternateAuthorization")}
        </button>
      </p>
    </>
  );
}

export function getCopyMethodTitleKey(method: CopyConnectMethod) {
  return method === "authorization"
    ? "steps.copyAuthorization.title"
    : "steps.copyCurl.title";
}

export function getCopyMethodChecklistKey(method: CopyConnectMethod) {
  return method === "authorization"
    ? "steps.copyAuthorization.checklist"
    : "steps.copyCurl.checklist";
}
