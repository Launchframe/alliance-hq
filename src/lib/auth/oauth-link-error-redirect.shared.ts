import { locales } from "@/i18n/routing";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const OAUTH_ACCOUNT_NOT_LINKED = "OAuthAccountNotLinked";
export const OAUTH_ACCOUNT_ALREADY_LINKED = "OAuthAccountAlreadyLinked";
export const OAUTH_PROVIDER_TYPE_ALREADY_LINKED = "OAuthProviderTypeAlreadyLinked";

/** Pages that surface `linkError` for signed-in OAuth account linking. */
const ACCOUNT_LINK_PATHS = new Set(["/account", "/settings/account"]);

function defaultLinkErrorPath(linkError: string): string {
  return `/settings/account?linkError=${linkError}`;
}

/**
 * Map the Auth.js callback URL (cookie or query) to the page that initiated
 * OAuth linking, with the given `linkError` code.
 */
export function oauthAccountLinkErrorRedirect(
  callbackUrl: string | null | undefined,
  linkError: string = OAUTH_ACCOUNT_NOT_LINKED,
): string {
  const path = toInternalPath(callbackUrl);
  if (!path) {
    return defaultLinkErrorPath(linkError);
  }

  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  const { localePrefix, pathWithoutLocale } = splitLocalePrefix(pathname);

  if (!ACCOUNT_LINK_PATHS.has(pathWithoutLocale)) {
    return defaultLinkErrorPath(linkError);
  }

  return `${localePrefix}${pathWithoutLocale}?linkError=${linkError}`;
}

function toInternalPath(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  let trimmed = value.trim();
  try {
    trimmed = decodeURIComponent(trimmed);
  } catch {
    // keep raw value
  }

  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      return sanitizeInternalRedirectPath(`${url.pathname}${url.search}`);
    } catch {
      return null;
    }
  }

  return sanitizeInternalRedirectPath(trimmed);
}

function splitLocalePrefix(pathname: string): {
  localePrefix: string;
  pathWithoutLocale: string;
} {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix) {
      return { localePrefix: prefix, pathWithoutLocale: "/" };
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return {
        localePrefix: prefix,
        pathWithoutLocale: pathname.slice(prefix.length),
      };
    }
  }
  return { localePrefix: "", pathWithoutLocale: pathname };
}
