import { locales, type AppLocale } from "@/i18n/routing";

/** next-intl default cookie name (`receiveLocaleCookie`). */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const VERCEL_IP_COUNTRY_HEADER = "x-vercel-ip-country";

const COUNTRY_TO_LOCALE: Record<string, AppLocale> = {
  BR: "pt-BR",
  PT: "pt-BR",
};

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value != null && (locales as readonly string[]).includes(value);
}

export function localeFromVercelCountry(
  country: string | null | undefined,
): AppLocale | null {
  if (!country) return null;
  const code = country.trim().toUpperCase();
  return COUNTRY_TO_LOCALE[code] ?? null;
}

export function pathnameHasNonDefaultLocalePrefix(pathname: string): boolean {
  return pathname === "/pt-BR" || pathname.startsWith("/pt-BR/");
}

export function withLocalePrefix(pathname: string, locale: AppLocale): string {
  if (locale === "en-US") return pathname;
  if (pathnameHasNonDefaultLocalePrefix(pathname)) return pathname;
  if (pathname === "/") return `/${locale}`;
  return `/${locale}${pathname}`;
}

export type GeoLocaleRedirectDecision =
  | { action: "passthrough" }
  | { action: "redirect"; locale: AppLocale; pathname: string };

/**
 * First-visit geo suggestion. Path prefix and an existing locale cookie win.
 * Only non-default locales need a redirect (as-needed prefix).
 */
export function decideGeoLocaleRedirect(input: {
  pathname: string;
  localeCookie: string | undefined;
  vercelCountry: string | null;
}): GeoLocaleRedirectDecision {
  if (pathnameHasNonDefaultLocalePrefix(input.pathname)) {
    return { action: "passthrough" };
  }
  if (isAppLocale(input.localeCookie)) {
    return { action: "passthrough" };
  }
  const suggested = localeFromVercelCountry(input.vercelCountry);
  if (!suggested || suggested === "en-US") {
    return { action: "passthrough" };
  }
  return {
    action: "redirect",
    locale: suggested,
    pathname: withLocalePrefix(input.pathname, suggested),
  };
}
