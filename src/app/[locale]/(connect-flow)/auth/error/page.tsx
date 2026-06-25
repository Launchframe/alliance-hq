import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { isOAuthAccountNotLinkedError } from "@/lib/auth/auth-sign-in-errors.shared";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
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
  const { error, callbackUrl } = await searchParams;
  const code = error?.trim() || "Default";

  if (!isMagicLinkError(code)) {
    if (isOAuthAccountNotLinkedError(code)) {
      return (
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#f85149]/40 bg-[#f85149]/10 p-6">
          <h1 className="text-xl font-semibold text-[#e6edf3]">
            {t("errorOAuthAccountNotLinkedTitle")}
          </h1>
          <p className="text-sm text-[#8b949e]">
            {t("errorOAuthAccountNotLinkedBody")}
          </p>
          <p className="text-xs text-[#6e7681]">
            {t("errorOAuthAccountNotLinkedHint")}
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <Link
              href={authRetryHref(callbackUrl)}
              className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm text-white"
            >
              {t("backToSignIn")}
            </Link>
            <Link
              href="/settings/account"
              className="text-center text-sm text-[#58a6ff] hover:underline"
            >
              {t("errorOAuthAccountNotLinkedAccountLink")}
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
        <p className="text-sm text-[#8b949e]">
          {t(credentialErrorMessageKey(code))}
        </p>
        <Link
          href={authRetryHref(callbackUrl)}
          className="inline-block text-sm text-[#58a6ff] hover:underline"
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
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#f85149]/40 bg-[#f85149]/10 p-6">
      <h1 className="text-xl font-semibold text-[#e6edf3]">{t(titleKey)}</h1>
      <p className="text-sm text-[#8b949e]">{t(bodyKey)}</p>
      {code === "Verification" ? (
        <p className="text-xs text-[#6e7681]">{t("errorVerificationHint")}</p>
      ) : null}
      <div className="flex flex-col gap-2 pt-1">
        <Link
          href={retryHref}
          className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm text-white"
        >
          {t("errorRequestNewLink")}
        </Link>
        <Link href="/" className="text-center text-sm text-[#58a6ff] hover:underline">
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
