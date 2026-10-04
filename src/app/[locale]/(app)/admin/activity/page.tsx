import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { redirect } from "@/i18n/navigation";
import {
  activityAllowedScopes,
  getActivityPrincipalForSession,
} from "@/lib/activity/access.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage() {
  const session = await requirePageSession("/admin/activity");
  const principal = await getActivityPrincipalForSession(session);
  if (!principal || !activityAllowedScopes(principal).includes("global")) {
    notFound();
  }
  redirect({ href: "/activity?scope=global", locale: await getLocale() });
}
