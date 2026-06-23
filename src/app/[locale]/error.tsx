"use client";

import { useTranslations } from "next-intl";

import { HttpErrorPage } from "@/components/errors/HttpErrorPage";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function LocaleErrorPage({ reset }: Props) {
  const t = useTranslations("httpErrors");

  return (
    <HttpErrorPage
      title={t("serverErrorTitle")}
      body={t("serverErrorBody")}
      hint={t("serverErrorHint")}
      tone="error"
      retryLabel={t("tryAgain")}
      onRetry={reset}
      homeLabel={t("goHome")}
      homeHref="/"
      secondaryLabel={t("goSignIn")}
      secondaryHref="/auth"
    />
  );
}
