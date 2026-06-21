import "server-only";

import { getLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import { redirect } from "@/i18n/navigation";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export async function requireAuthForPage(callbackPath = "/") {
  const locale = await getLocale();
  const safeCallback =
    sanitizeInternalRedirectPath(callbackPath) ?? callbackPath;
  const authSession = await auth();
  const user = authSession?.user;

  if (!user?.id || !user.email) {
    const query =
      safeCallback && safeCallback !== "/"
        ? `?callbackUrl=${encodeURIComponent(safeCallback)}`
        : "";
    redirect({ href: `/auth${query}`, locale });
    throw new Error("Auth redirect");
  }

  await bridgeAuthUserToBrowserSession({
    hqUserId: user.id,
    email: user.email,
    displayName: user.name,
  });

  return authSession;
}
