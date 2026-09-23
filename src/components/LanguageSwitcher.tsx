"use client";

import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();

  return (
    <label className="inline-flex min-w-0 items-center gap-2 text-sm text-hq-fg">
      <span className="shrink-0">{t("label")}</span>
      <AppSelect
        className="w-auto max-w-56"
        value={locale}
        onChange={(next) => {
          const search = searchParams.toString();
          const href = search ? `${pathname}?${search}` : pathname;
          replaceLocale(href, next as AppLocale);
        }}
        aria-label={t("label")}
        triggerClassName="rounded border border-hq-border bg-hq-canvas px-2 py-1.5 text-sm"
        options={locales.map((code) => ({
          value: code,
          label: t(code),
        }))}
      />
    </label>
  );
}
