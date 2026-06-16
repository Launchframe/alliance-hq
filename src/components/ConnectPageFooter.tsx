"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ashedLink } from "@/components/i18n/richText";

export function ConnectPageFooter() {
  const t = useTranslations("footer");

  return (
    <footer className="border-t border-[#30363d] px-4 py-6 text-center text-xs text-[#8b949e]">
      <p>
        {t.rich("attribution", { link: ashedLink })}
      </p>
      <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
        <Link href="/privacy" className="text-[#58a6ff] hover:underline">
          {t("privacyPolicy")}
        </Link>
        <Link href="/terms" className="text-[#58a6ff] hover:underline">
          {t("termsOfService")}
        </Link>
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
