import "server-only";

import { getLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { bridgeAuthUserToPageSession } from "@/lib/auth/bridge-session";
import { loadHqUserEmailById } from "@/lib/auth/change-hq-email.server";
import { resolveSessionHqUserId } from "@/lib/auth/resolve-session-hq-user.server";
import { redirect } from "@/i18n/navigation";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export async function requireAuthForPage(callbackPath = "/") {
  const locale = await getLocale();
  const safeCallback =
    sanitizeInternalRedirectPath(callbackPath) ?? callbackPath;
  const authSession = await auth();
  const user = authSession?.user;

  if (!authSession || !user?.email) {
    const query =
      safeCallback && safeCallback !== "/"
        ? `?callbackUrl=${encodeURIComponent(safeCallback)}`
        : "";
    redirect({ href: `/auth${query}`, locale });
    throw new Error("Auth redirect");
  }

  const hqUserId = await resolveSessionHqUserId(authSession);
  if (!hqUserId) {
    const query =
      safeCallback && safeCallback !== "/"
        ? `?callbackUrl=${encodeURIComponent(safeCallback)}`
        : "";
    redirect({ href: `/auth${query}`, locale });
    throw new Error("Auth redirect");
  }

  const email = (await loadHqUserEmailById(hqUserId)) ?? user.email;

  await bridgeAuthUserToPageSession(
    {
      hqUserId,
      email,
      displayName: user.name,
    },
    safeCallback,
  );

  user.id = hqUserId;
  user.email = email;

  return authSession;
}
