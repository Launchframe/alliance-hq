import { getTranslations } from "next-intl/server";

import { HttpErrorPage } from "@/components/errors/HttpErrorPage";

export default async function NotFoundPage() {
  const t = await getTranslations("httpErrors");

  return (
    <HttpErrorPage
      title={t("notFoundTitle")}
      body={t("notFoundBody")}
      hint={t("notFoundHint")}
      tone="notFound"
      homeLabel={t("goHome")}
      homeHref="/"
      secondaryLabel={t("goSignIn")}
      secondaryHref="/auth"
    />
  );
}
