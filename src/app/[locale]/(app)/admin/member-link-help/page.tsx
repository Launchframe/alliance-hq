import { getTranslations } from "next-intl/server";

import { MemberLinkHelpRequestsClient } from "@/components/members/MemberLinkHelpRequestsClient";
import { listMemberLinkHelpRequestsForAdmin } from "@/lib/member-link/member-link-help-queue.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("memberLinkHelpRequests");
  return { title: t("adminTitle") };
}

export default async function AdminMemberLinkHelpPage() {
  await requirePageSession("/admin/member-link-help");
  const t = await getTranslations("memberLinkHelpRequests");
  const requests = await listMemberLinkHelpRequestsForAdmin("open");

  return (
    <MemberLinkHelpRequestsClient
      titleKey="adminTitle"
      initialRequests={requests.map((row) => ({
        id: row.id,
        allianceId: row.allianceId,
        allianceTag: row.allianceTag,
        allianceName: row.allianceName,
        origin: row.origin,
        context: row.context,
        requesterHandle: row.requesterHandle,
        reportedName: row.reportedName,
        gameUserName: row.gameUserName,
        gameUidLast4: row.gameUidLast4,
        discordUsername: row.discordUsername,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      }))}
      detailHrefPrefix="/admin/member-link-help"
      showAlliance
      backHref="/admin"
      backLabel={t("backToAdmin")}
    />
  );
}
