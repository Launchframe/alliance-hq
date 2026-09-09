"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { HttpErrorPage } from "@/components/errors/HttpErrorPage";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

/** App-shell error boundary — captures to Sentry; retry without forced sign-out. */
export default function AppErrorPage({ error, reset }: Props) {
  const t = useTranslations("httpErrors");

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <HttpErrorPage
      title={t("serverErrorTitle")}
      body={t("serverErrorBody")}
      hint={t("serverErrorHint")}
      tone="error"
      retryLabel={t("tryAgain")}
      onRetry={reset}
      homeLabel={t("goHome")}
      homeHref="/dashboard"
    />
  );
}
