import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MembershipSettingsClient } from "@/components/vs-compliance/MembershipSettingsClient";
import { getDb, schema } from "@/lib/db";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePageSession } from "@/lib/session";
import { VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { firstFullVsWeek } from "@/lib/vs-compliance/policy.shared";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("vsCompliance");
  return allianceScopedMetadata(t("settings"));
}

export default async function MembershipMinimumsPage() {
  const session = await requirePageSession("/settings/vs-membership-minimums");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();
  try { await requireVsComplianceAccess(session.id, allianceId, VS_COMPLIANCE_READ_PERMISSION); }
  catch (error) { if (error instanceof VsComplianceError && error.code === "forbidden") notFound(); throw error; }
  const [alliance] = await getDb().select({ tag: schema.alliances.tag }).from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
  if (!alliance?.tag) notFound();
  return <MembershipSettingsClient key={allianceId} allianceTag={alliance.tag} earliestWeek={firstFullVsWeek(new Date())} />;
}
