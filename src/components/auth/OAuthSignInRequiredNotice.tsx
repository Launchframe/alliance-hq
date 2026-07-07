"use client";

import { useTranslations } from "next-intl";

import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";
import { formatLinkedOAuthProviderList } from "@/lib/auth/email-sign-in-restriction.shared";

export type OAuthSignInRequiredDetails = {
  email: string;
  linkedProviders: LinkedOAuthProvider[];
};

export function OAuthSignInRequiredNotice({
  details,
}: {
  details: OAuthSignInRequiredDetails;
}) {
  const t = useTranslations("auth");
  const providers = formatLinkedOAuthProviderList(details.linkedProviders, {
    google: t("methodGoogle"),
    discord: t("methodDiscord"),
  });

  return (
    <div
      className="space-y-2 rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2.5"
      role="alert"
    >
      <p className="text-sm font-medium text-hq-fg">
        {t("errorOAuthSignInRequiredTitle")}
      </p>
      <p className="text-sm text-hq-fg-muted">{t("errorOAuthSignInRequiredBody")}</p>
      <p className="text-sm text-hq-fg">
        {t("errorOAuthSignInRequiredAction", {
          providers,
          email: details.email,
        })}
      </p>
      <p className="text-xs text-hq-fg-subtle">{t("errorOAuthSignInRequiredHint")}</p>
    </div>
  );
}
