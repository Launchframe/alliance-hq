import { locales, type AppLocale } from "@/i18n/routing";

export type UserLocaleSource = "manual" | "lastrank" | "default";

export type UserLocaleResolution = {
  locale: AppLocale;
  source: UserLocaleSource;
};

export const USER_LOCALE_AUTOMATIC = "auto";

const LASTRANK_COUNTRY_TO_LOCALE: Record<string, AppLocale> = {
  BR: "pt-BR",
  PT: "pt-BR",
  ID: "id",
};

export function isAppLocaleValue(value: unknown): value is AppLocale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function localeFromLastRankCountry(
  country: string | null | undefined,
): AppLocale | null {
  const code = country?.trim().toUpperCase();
  return code ? (LASTRANK_COUNTRY_TO_LOCALE[code] ?? null) : null;
}

/** Manual pick wins; LastRank country is the default when nothing was picked. */
export function resolveUserLocale(input: {
  manual: string | null | undefined;
  lastrankCountries: ReadonlyArray<string | null | undefined>;
}): UserLocaleResolution {
  if (isAppLocaleValue(input.manual)) {
    return { locale: input.manual, source: "manual" };
  }
  for (const country of input.lastrankCountries) {
    const locale = localeFromLastRankCountry(country);
    if (locale) return { locale, source: "lastrank" };
  }
  return { locale: "en-US", source: "default" };
}
