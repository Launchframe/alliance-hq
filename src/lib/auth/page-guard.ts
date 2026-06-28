import "server-only";

import { getLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { bridgeAuthUserToPageSession } from "@/lib/auth/bridge-session";
import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";
import { redirect } from "@/i18n/navigation";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export async function requireAuthForPage(callbackPath = "/") {
  const locale = await getLocale();
  const safeCallback =
    sanitizeInternalRedirectPath(callbackPath) ?? callbackPath;
  const authSession = await auth();
  const user = authSession?.user;

  if (!authSession || !user?.id || !user.email) {
    const query =
      safeCallback && safeCallback !== "/"
        ? `?callbackUrl=${encodeURIComponent(safeCallback)}`
        : "";
    redirect({ href: `/auth${query}`, locale });
    throw new Error("Auth redirect");
  }

  // The Auth.js JWT may carry a `user.id` that is not a row in this DB's
  // `hq_users` (e.g. token minted against another database). Resolve/create the
  // canonical row by email so the session FK target exists, matching
  // `requireAuthSession`.
  const hqUserId = await ensureHqUserForAuthEmail(user.email, user.name);

  await bridgeAuthUserToPageSession(
    {
      hqUserId,
      email: user.email,
      displayName: user.name,
    },
    safeCallback,
  );

  user.id = hqUserId;

  return authSession;
}
