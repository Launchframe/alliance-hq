import { getTranslations } from "next-intl/server";

import { HttpErrorPage } from "@/components/errors/HttpErrorPage";
import { auth } from "@/lib/auth";

export default async function NotFoundPage() {
  const t = await getTranslations("httpErrors");
  const session = await auth();
  const signedIn = Boolean(session?.user?.id?.trim());

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
