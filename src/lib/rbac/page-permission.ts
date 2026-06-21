import "server-only";

import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

import { sessionHasPermission } from "./context";

export async function requirePagePermission(
  sessionId: string,
  permission: string,
  redirectTo = "/members",
): Promise<void> {
  if (!(await sessionHasPermission(sessionId, permission))) {
    const locale = await getLocale();
    redirect({ href: redirectTo, locale });
  }
}
