import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ email?: string; callbackUrl?: string }>;
};

export default async function AuthCheckEmailPage({ searchParams }: Props) {
  const t = await getTranslations("auth");
  const { email, callbackUrl } = await searchParams;
  const safeCallback = sanitizeInternalRedirectPath(callbackUrl);
  const retryHref = safeCallback
    ? `/auth?callbackUrl=${encodeURIComponent(safeCallback)}${
        email?.trim() ? `&email=${encodeURIComponent(email.trim())}` : ""
      }`
    : email?.trim()
      ? `/auth?email=${encodeURIComponent(email.trim())}`
      : "/auth";

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-hq-border bg-hq-surface p-6">
      <h1 className="text-xl font-semibold">{t("checkEmailTitle")}</h1>
      <p className="text-sm text-hq-fg-muted">
        {t("checkEmailBody", { email: email?.trim() || t("yourInbox") })}
      </p>
      <p className="text-sm text-hq-fg-muted">{t("checkEmailSpamHint")}</p>
      <p className="text-xs text-hq-fg-subtle">{t("checkEmailHint")}</p>
      <Link href={retryHref} className="inline-block text-sm text-hq-accent hover:underline">
        {t("tryAgain")}
      </Link>
    </div>
  );
}
