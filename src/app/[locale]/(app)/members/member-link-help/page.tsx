import { getTranslations } from "next-intl/server";

import { MemberLinkHelpRequestsClient } from "@/components/members/MemberLinkHelpRequestsClient";
import { listMemberLinkHelpRequestsForAlliance } from "@/lib/member-link/member-link-help-queue.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("memberLinkHelpRequests");
  return { title: t("title") };
}

export default async function MemberLinkHelpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/members/member-link-help");
  const canResolve = await sessionHasPermission(session.id, "members:write");
  if (!canResolve) {
    redirect({ href: "/members", locale });
  }

  const t = await getTranslations("memberLinkHelpRequests");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  const requests = allianceId
    ? await listMemberLinkHelpRequestsForAlliance(allianceId, "open")
    : [];

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 min-w-0 w-full">
      <MemberLinkHelpRequestsClient
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
        listUrl="/api/members/member-link-help-requests"
        resolveUrlPrefix="/api/members/member-link-help-requests"
        backHref="/members"
        backLabel={t("backToMembers")}
      />
    </div>
  );
}
