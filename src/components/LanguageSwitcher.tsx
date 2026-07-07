"use client";

import { useLocale, useTranslations } from "next-intl";

import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";
import { usePathname } from "@/i18n/navigation";
import { AppSelect } from "@/components/ui/AppSelect";
import { locales, type AppLocale } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale() as AppLocale;
  const { replaceLocale } = useShellNavigation();
  const pathname = usePathname();

  return (
    <label className="inline-flex items-center gap-2 text-xs text-hq-fg-muted">
      <span className="sr-only">{t("label")}</span>
      <AppSelect
        value={locale}
        onChange={(next) => {
          replaceLocale(pathname, next as AppLocale);
        }}
        aria-label={t("label")}
        triggerClassName="rounded border border-hq-border bg-hq-canvas px-2 py-1 text-xs"
        options={locales.map((code) => ({
          value: code,
          label: t(code),
        }))}
      />
    </label>
  );
}
