import { locales } from "@/i18n/routing";

const INVITE_ACCEPT_PATH = /^\/invite\/[^/]+/;

/** True when Auth.js should use invite-oriented Discord-first copy. */
export function isInviteAuthFlow(input: {
  fromInvite?: string | null;
  callbackUrl?: string | null;
}): boolean {
  if (input.fromInvite?.trim() === "invite") {
    return true;
  }
  const callback = input.callbackUrl?.trim() ?? "";
  if (!callback) {
    return false;
  }
  return isInviteAcceptCallbackPath(callback);
}

function isInviteAcceptCallbackPath(callback: string): boolean {
  try {
    const pathname = callback.startsWith("http")
      ? new URL(callback).pathname
      : callback.split("?")[0]?.split("#")[0] ?? callback;
    return INVITE_ACCEPT_PATH.test(stripLocalePrefix(pathname));
  } catch {
    return INVITE_ACCEPT_PATH.test(stripLocalePrefix(callback));
  }
}

function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix) {
      return "/";
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length);
    }
  }
  return pathname;
}
