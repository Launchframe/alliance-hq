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
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h1 className="text-xl font-semibold">{t("checkEmailTitle")}</h1>
      <p className="text-sm text-[#8b949e]">
        {t("checkEmailBody", { email: email?.trim() || t("yourInbox") })}
      </p>
      <p className="text-sm text-[#8b949e]">{t("checkEmailSpamHint")}</p>
      <p className="text-xs text-[#6e7681]">{t("checkEmailHint")}</p>
      <Link href={retryHref} className="inline-block text-sm text-[#58a6ff] hover:underline">
        {t("tryAgain")}
      </Link>
    </div>
  );
}
