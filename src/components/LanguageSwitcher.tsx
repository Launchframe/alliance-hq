"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type AppLocale } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="inline-flex items-center gap-2 text-xs text-[#8b949e]">
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        onChange={(e) => {
          router.replace(pathname, { locale: e.target.value as AppLocale });
        }}
        className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-[#e6edf3]"
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {t(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
