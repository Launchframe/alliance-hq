import { defineRouting } from "next-intl/routing";

export const locales = ["en-US", "pt-BR"] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en-US",
  localePrefix: "as-needed",
});
