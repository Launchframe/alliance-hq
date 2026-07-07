import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import {
  isOAuthAccountNotLinkedError,
  isOAuthSignInRequiredError,
} from "@/lib/auth/auth-sign-in-errors.shared";
import {
  formatLinkedOAuthProviderList,
  parseOAuthSignInRequiredSearchParams,
} from "@/lib/auth/email-sign-in-restriction.shared";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    error?: string;
    callbackUrl?: string;
    email?: string;
    providers?: string;
  }>;
};

function authRetryHref(callbackUrl: string | undefined): string {
  const safe = sanitizeInternalRedirectPath(callbackUrl);
  if (!safe) {
    return "/auth";
  }
  return `/auth?callbackUrl=${encodeURIComponent(safe)}`;
}

function credentialErrorMessageKey(
  error: string,
): "errorConfiguration" | "errorCredentials" | "errorGeneric" {
  if (error === "Configuration") {
    return "errorConfiguration";
  }
  if (error === "CredentialsSignin") {
    return "errorCredentials";
  }
  return "errorGeneric";
}

function isMagicLinkError(code: string): boolean {
  return code === "Verification" || code === "AccessDenied";
}

export default async function AuthErrorPage({ searchParams }: Props) {
  const t = await getTranslations("auth");
  const { error, callbackUrl, email, providers } = await searchParams;
  const code = error?.trim() || "Default";
  const oauthSignInRequired = parseOAuthSignInRequiredSearchParams({
    error: code,
    email,
    providers,
  });

  if (!isMagicLinkError(code)) {
    if (isOAuthAccountNotLinkedError(code)) {
      return (
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-hq-danger/40 bg-hq-danger/10 p-6">
          <h1 className="text-xl font-semibold text-hq-fg">
            {t("errorOAuthAccountNotLinkedTitle")}
          </h1>
          <p className="text-sm text-hq-fg-muted">
            {t("errorOAuthAccountNotLinkedBody")}
          </p>
          <p className="text-xs text-hq-fg-subtle">
            {t("errorOAuthAccountNotLinkedHint")}
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <Link
              href={authRetryHref(callbackUrl)}
              className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-center text-sm text-white"
            >
              {t("backToSignIn")}
            </Link>
            <Link
              href="/settings/account"
              className="text-center text-sm text-hq-accent hover:underline"
            >
              {t("errorOAuthAccountNotLinkedAccountLink")}
            </Link>
          </div>
        </div>
      );
    }

    if (isOAuthSignInRequiredError(code) && oauthSignInRequired) {
      const providerLabels = formatLinkedOAuthProviderList(
        oauthSignInRequired.linkedProviders,
        {
          google: t("methodGoogle"),
          discord: t("methodDiscord"),
        },
      );

      return (
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-hq-danger/40 bg-hq-danger/10 p-6">
          <h1 className="text-xl font-semibold text-hq-fg">
            {t("errorOAuthSignInRequiredTitle")}
          </h1>
          <p className="text-sm text-hq-fg-muted">{t("errorOAuthSignInRequiredBody")}</p>
          <p className="text-sm text-hq-fg">
            {t("errorOAuthSignInRequiredAction", {
              providers: providerLabels,
              email: oauthSignInRequired.email,
            })}
          </p>
          <p className="text-xs text-hq-fg-subtle">{t("errorOAuthSignInRequiredHint")}</p>
          <Link
            href={authRetryHref(callbackUrl)}
            className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-center text-sm text-white"
          >
            {t("backToSignIn")}
          </Link>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-6">
        <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
        <p className="text-sm text-hq-fg-muted">
          {t(credentialErrorMessageKey(code))}
        </p>
        <Link
          href={authRetryHref(callbackUrl)}
          className="inline-block text-sm text-hq-accent hover:underline"
        >
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }

  const titleKey =
    code === "Verification"
      ? "errorVerificationTitle"
      : "errorAccessDeniedTitle";

  const bodyKey =
    code === "Verification"
      ? "errorVerificationBody"
      : "errorAccessDeniedBody";

  const retryHref = authRetryHref(callbackUrl);

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-hq-danger/40 bg-hq-danger/10 p-6">
      <h1 className="text-xl font-semibold text-hq-fg">{t(titleKey)}</h1>
      <p className="text-sm text-hq-fg-muted">{t(bodyKey)}</p>
      {code === "Verification" ? (
        <p className="text-xs text-hq-fg-subtle">{t("errorVerificationHint")}</p>
      ) : null}
      <div className="flex flex-col gap-2 pt-1">
        <Link
          href={retryHref}
          className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-center text-sm text-white"
        >
          {t("errorRequestNewLink")}
        </Link>
        <Link href="/" className="text-center text-sm text-hq-accent hover:underline">
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
