"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ashedLink } from "@/components/i18n/richText";

export function ConnectPageFooter() {
  const t = useTranslations("footer");

  return (
    <footer className="border-t border-hq-border px-4 py-6 text-center text-xs text-hq-fg-muted">
      <p>
        {t.rich("attribution", { link: ashedLink })}
      </p>
      <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
        <Link href="/privacy" className="text-hq-accent hover:underline">
          {t("privacyPolicy")}
        </Link>
        <Link href="/terms" className="text-hq-accent hover:underline">
          {t("termsOfService")}
        </Link>
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
