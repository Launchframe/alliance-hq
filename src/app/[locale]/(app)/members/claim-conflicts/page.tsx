import { getTranslations } from "next-intl/server";

import { ClaimConflictsClient } from "@/components/members/ClaimConflictsClient";
import { listClaimConflicts } from "@/lib/member-link/claim-conflict-queue.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("claimConflicts");
  return { title: t("title") };
}

export default async function ClaimConflictsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/members/claim-conflicts");
  const canResolve = await sessionHasPermission(session.id, "members:write");
  if (!canResolve) {
    redirect({ href: "/members", locale });
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  const conflicts = allianceId
    ? await listClaimConflicts({ allianceId, status: "open" })
    : [];

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 min-w-0 w-full">
      <ClaimConflictsClient
        initialConflicts={conflicts.map((conflict) => ({
          id: conflict.id,
          commanderName: conflict.commanderName,
          handle: conflict.handle,
          reason: conflict.reason as
            | "name_collision"
            | "commander_taken"
            | "server_mismatch"
            | "target_mismatch",
          status: conflict.status as "open" | "resolved" | "dismissed",
          createdAt: conflict.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
