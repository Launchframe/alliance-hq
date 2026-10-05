import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { getDb, schema } from "@/lib/db";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePageSession } from "@/lib/session";
import { addCalendarDays, getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return allianceScopedMetadata(t("vsPerformance"));
}

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ weekEnding?: string | string[]; eventId?: string | string[] }> }) {
  const session = await requirePageSession("/vs-compliance");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();
  try {
    await requireVsComplianceAccess(session.id, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  } catch (error) {
    if (error instanceof VsComplianceError && error.code === "forbidden") notFound();
    throw error;
  }
  const locale = await getLocale();
  const { weekEnding, eventId } = await searchParams;
  if (eventId !== undefined) {
    if (typeof eventId !== "string" || !eventId.trim() || eventId.length > 256) notFound();
    const [event] = await getDb().select({
      memberId: schema.vsComplianceEvaluations.memberId,
      weekEnding: schema.vsComplianceEvaluations.weekEnding,
    }).from(schema.vsComplianceEvaluations).where(and(
      eq(schema.vsComplianceEvaluations.allianceId, allianceId),
      eq(schema.vsComplianceEvaluations.id, eventId),
    )).limit(1);
    if (!event || !validateVsPeriod(event.weekEnding, "weekly") || event.weekEnding > lastClosedVsWeek()) notFound();
    redirect({ href: `/vs-performance/members/${encodeURIComponent(event.memberId)}?week=${addCalendarDays(event.weekEnding, -6)}`, locale });
  }
  const monday = typeof weekEnding === "string" && validateVsPeriod(weekEnding, "weekly") && weekEnding <= lastClosedVsWeek()
    ? addCalendarDays(weekEnding, -6)
    : getWeekStartMonday(getServerCalendarDate());
  redirect({ href: `/vs-performance?week=${monday}`, locale });
}
