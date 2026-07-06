import { getTranslations } from "next-intl/server";

import { AllianceSetupRequestsClient } from "@/components/admin/AllianceSetupRequestsClient";
import { listAllianceSetupRequestsForAdmin } from "@/lib/alliance/alliance-setup-request.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin.allianceSetupRequests");
  return { title: t("title") };
}

export default async function AdminAllianceSetupRequestsPage() {
  await requirePageSession("/admin/alliance-setup-requests");
  const requests = await listAllianceSetupRequestsForAdmin("open");

  return (
    <AllianceSetupRequestsClient
      initialRequests={requests.map((row) => ({
        id: row.id,
        tag: row.tag,
        allianceName: row.allianceName,
        gameServerNumber: row.gameServerNumber,
        requesterEmail: row.requesterEmail,
        createdAt: row.createdAt.toISOString(),
      }))}
    />
  );
}
