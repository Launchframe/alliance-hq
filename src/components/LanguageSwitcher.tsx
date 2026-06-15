"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { AppSelect } from "@/components/ui/AppSelect";
import { locales, type AppLocale } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="inline-flex items-center gap-2 text-xs text-[#8b949e]">
      <span className="sr-only">{t("label")}</span>
      <AppSelect
        value={locale}
        onChange={(next) => {
          router.replace(pathname, { locale: next as AppLocale });
        }}
        aria-label={t("label")}
        triggerClassName="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs"
        options={locales.map((code) => ({
          value: code,
          label: t(code),
        }))}
      />
    </label>
  );
}
