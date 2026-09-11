import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/session";
import { standalonePageMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { loadCalendarSettings } from "@/lib/calendar/settings.server";
import { CalendarConnectionsClient } from "@/components/calendar/CalendarConnectionsClient";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("calendarConnections");
  return standalonePageMetadata(t("title"));
}
export default async function CalendarConnectionsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const session = await requirePageSession("/account/calendars");
  if (!session.hqUserId) notFound();
  return <CalendarConnectionsClient key={session.hqUserId} initial={await loadCalendarSettings(session.hqUserId, await getLocale())} initialError={(await searchParams).calendar === "failed"} />;
}
