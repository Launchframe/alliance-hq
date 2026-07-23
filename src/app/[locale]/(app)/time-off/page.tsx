import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { TimeOffCalendarClient } from "@/components/time-off/TimeOffCalendarClient";
import { loadTimeOffCalendar } from "@/lib/time-off/load-dashboard.server";
import { TIME_OFF_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("timeOff");
  return { title: t("title") };
}

export default async function TimeOffPage() {
  const session = await requirePageSession("/time-off");
  await requirePagePermission(session.id, TIME_OFF_READ_PERMISSION);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    notFound();
  }

  const dashboard = await loadTimeOffCalendar({
    sessionId: session.id,
    hqUserId: session.hqUserId ?? null,
    allianceId,
  });

  if ("forbidden" in dashboard) {
    notFound();
  }

  return <TimeOffCalendarClient initial={dashboard} />;
}
