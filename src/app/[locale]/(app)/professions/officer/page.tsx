import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { OfficerPortal } from "@/components/professions/OfficerPortal";
import { requirePageSession } from "@/lib/session";
import { sessionHasPermission } from "@/lib/rbac/context";
import { getOfficerProfessionPortal } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("professions");
  return { title: t("officerTitle") };
}

export default async function ProfessionsOfficerRoute() {
  const session = await requirePageSession("/professions/officer");
  const allowed = await sessionHasPermission(session.id, "alliance:admin");
  if (!allowed) notFound();

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();

  const data = await getOfficerProfessionPortal(allianceId);

  return <OfficerPortal data={data} allianceId={allianceId} />;
}
