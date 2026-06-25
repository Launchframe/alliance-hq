import { getTranslations } from "next-intl/server";

import { RosterLinkRequestsClient } from "@/components/members/RosterLinkRequestsClient";
import { listPendingRosterLinkRequests } from "@/lib/member-link/roster-link-resolve.server";
import { loadAllianceMembers } from "@/lib/members/load";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("rosterLinkRequests");
  return { title: t("title") };
}

export default async function RosterLinkRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/members/roster-link-requests");
  const canResolve = await sessionHasPermission(session.id, "members:write");
  if (!canResolve) {
    redirect({ href: "/members", locale });
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  const [requests, membersPayload] = await Promise.all([
    allianceId ? listPendingRosterLinkRequests(allianceId) : Promise.resolve([]),
    loadAllianceMembers(session.id).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 min-w-0 w-full">
      <RosterLinkRequestsClient
        initialRequests={requests.map((request) => ({
          id: request.id,
          origin: request.origin,
          reportedName: request.reportedName,
          gameUserName: request.gameUserName,
          gameUidLast4: request.gameUidLast4,
          gameServerNumber: request.gameServerNumber,
          discordUsername: request.discordUsername,
          suggestedTargetAshedMemberId: request.suggestedTargetAshedMemberId,
          suggestionMethod: request.suggestionMethod,
          suggestedMatchedRosterName: request.suggestedMatchedRosterName,
        }))}
        initialMembers={
          membersPayload?.members.map((member) => ({
            id: member.id,
            current_name: member.current_name,
          })) ?? []
        }
      />
    </div>
  );
}
