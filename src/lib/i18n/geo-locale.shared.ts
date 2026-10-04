import { locales, type AppLocale } from "@/i18n/routing";

/** next-intl default cookie name (`receiveLocaleCookie`). */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const VERCEL_IP_COUNTRY_HEADER = "x-vercel-ip-country";

/** Match next-intl’s typical year-long NEXT_LOCALE persistence. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const COUNTRY_TO_LOCALE: Record<string, AppLocale> = {
  BR: "pt-BR",
  PT: "pt-BR",
};

/**
 * Unprefixed first-visit geo only on new-visitor / onboarding funnels.
 * App-shell routes keep next-intl cookie + Accept-Language (and the in-app picker).
 */
const CONNECT_FLOW_GEO_SEGMENTS = new Set([
  "auth",
  "b",
  "connect",
  "discord",
  "get-started",
  "invite",
  "join",
  "onboard",
  "pair",
  "privacy",
  "terms",
  "welcome",
]);

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

export function splitAppLocalePrefix(pathname: string): {
  locale: AppLocale | null;
  pathWithoutLocale: string;
} {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix) {
      return { locale, pathWithoutLocale: "/" };
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale, pathWithoutLocale: pathname.slice(prefix.length) };
    }
  }
  return { locale: null, pathWithoutLocale: pathname };
}

export function pathnameHasLocalePrefix(pathname: string): boolean {
  return splitAppLocalePrefix(pathname).locale != null;
}

export function isConnectFlowGeoPath(pathname: string): boolean {
  const path = splitAppLocalePrefix(pathname).pathWithoutLocale;
  if (path === "/") return true;
  const segment = path.split("/").filter(Boolean)[0];
  return Boolean(segment && CONNECT_FLOW_GEO_SEGMENTS.has(segment));
}

export function withLocalePrefix(pathname: string, locale: AppLocale): string {
  const { locale: existing, pathWithoutLocale } = splitAppLocalePrefix(pathname);
  if (existing) {
    return withLocalePrefix(pathWithoutLocale, locale);
  }
  if (locale === "en-US") return pathname;
  if (pathname === "/") return `/${locale}`;
  return `/${locale}${pathname}`;
}

export type GeoLocaleRedirectDecision =
  | { action: "passthrough" }
  | { action: "redirect"; locale: AppLocale; pathname: string };

/**
 * First-visit geo suggestion on connect-flow funnels only.
 * Path prefix (any app locale) and an existing locale cookie win.
 * Only non-default locales need a redirect (as-needed prefix).
 */
export function decideGeoLocaleRedirect(input: {
  pathname: string;
  localeCookie: string | undefined;
  vercelCountry: string | null;
}): GeoLocaleRedirectDecision {
  if (pathnameHasLocalePrefix(input.pathname)) {
    return { action: "passthrough" };
  }
  if (isAppLocale(input.localeCookie)) {
    return { action: "passthrough" };
  }
  if (!isConnectFlowGeoPath(input.pathname)) {
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
