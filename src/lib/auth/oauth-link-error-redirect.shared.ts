import { locales } from "@/i18n/routing";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const OAUTH_ACCOUNT_NOT_LINKED = "OAuthAccountNotLinked";

const DEFAULT_LINK_ERROR_PATH = `/settings/account?linkError=${OAUTH_ACCOUNT_NOT_LINKED}`;

/** Pages that surface `linkError` for signed-in OAuth account linking. */
const ACCOUNT_LINK_PATHS = new Set(["/account", "/settings/account"]);

/**
 * Map the Auth.js callback URL (cookie or query) to the page that initiated
 * OAuth linking, with `linkError=OAuthAccountNotLinked`.
 */
export function oauthAccountLinkErrorRedirect(
  callbackUrl: string | null | undefined,
): string {
  const path = toInternalPath(callbackUrl);
  if (!path) {
    return DEFAULT_LINK_ERROR_PATH;
  }

  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  const { localePrefix, pathWithoutLocale } = splitLocalePrefix(pathname);

  if (!ACCOUNT_LINK_PATHS.has(pathWithoutLocale)) {
    return DEFAULT_LINK_ERROR_PATH;
  }

  return `${localePrefix}${pathWithoutLocale}?linkError=${OAUTH_ACCOUNT_NOT_LINKED}`;
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
