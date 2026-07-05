import { getTranslations } from "next-intl/server";

import { HttpErrorPage } from "@/components/errors/HttpErrorPage";
import { hasSignedInAppSession } from "@/lib/session/has-signed-in-app-session.server";

export default async function NotFoundPage() {
  const t = await getTranslations("httpErrors");
  const signedIn = await hasSignedInAppSession();

  return (
    <HttpErrorPage
      title={t("notFoundTitle")}
      body={t("notFoundBody")}
      hint={signedIn ? t("notFoundHintSignedIn") : t("notFoundHint")}
      tone="notFound"
      homeLabel={t("goHome")}
      homeHref="/"
      secondaryLabel={signedIn ? t("goInbox") : t("goSignIn")}
      secondaryHref={signedIn ? "/inbox" : "/auth"}
    />
  );
}
