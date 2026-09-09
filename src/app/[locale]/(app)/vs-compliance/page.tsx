import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { ComplianceDashboardClient } from "@/components/vs-compliance/ComplianceDashboardClient";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePageSession } from "@/lib/session";
import { VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("vsCompliance");
  return allianceScopedMetadata(t("title"));
}

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ weekEnding?: string; eventId?: string }> }) {
  const session = await requirePageSession("/vs-compliance");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();
  try { await requireVsComplianceAccess(session.id, allianceId, VS_COMPLIANCE_READ_PERMISSION); }
  catch (error) { if (error instanceof VsComplianceError && error.code === "forbidden") notFound(); throw error; }
  const lastClosedWeek = lastClosedVsWeek();
  const { weekEnding, eventId } = await searchParams;
  const initialWeek = typeof weekEnding === "string" && validateVsPeriod(weekEnding, "weekly") && weekEnding <= lastClosedWeek ? weekEnding : lastClosedWeek;
  const highlightEventId = typeof eventId === "string" && eventId.trim() ? eventId.trim() : null;
  const [alliance] = await getDb().select({ tag: schema.alliances.tag }).from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
  if (!alliance?.tag) notFound();
  return <ComplianceDashboardClient key={allianceId} allianceTag={alliance.tag} initialWeek={initialWeek} lastClosedWeek={lastClosedWeek} highlightEventId={highlightEventId} />;
}
