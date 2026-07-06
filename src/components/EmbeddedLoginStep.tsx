"use client";

import { useTranslations } from "next-intl";

import { ashedLink, strongText } from "@/components/i18n/richText";

export function EmbeddedLoginStep() {
  const t = useTranslations("connect.embeddedLogin");

  return (
    <>
      <p className="rounded-lg border border-[#d29922]/40 bg-[#d29922]/10 px-3 py-2 text-sm">
        <strong className="text-[#e3b341]">{t("optionalLabel")}</strong>{" "}
        {t("optionalBody")}
      </p>

      <p className="mt-4">{t.rich("problemIntro", { link: ashedLink, strong: strongText })}</p>

      <p className="mt-3 text-sm text-hq-fg-muted">{t("workaroundIntro")}</p>

      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">
        <li>{t.rich("stepForgotPassword", { link: ashedLink, strong: strongText })}</li>
        <li>{t("stepResetEmail")}</li>
        <li>{t("stepChoosePassword")}</li>
        <li>{t.rich("stepFirstEmbedLogin", { strong: strongText })}</li>
      </ol>

      <p className="mt-4 text-sm text-hq-fg-muted">{t("googleStillWorksNote")}</p>
    </>
  );
}
