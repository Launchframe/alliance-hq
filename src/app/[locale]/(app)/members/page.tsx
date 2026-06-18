import { getTranslations } from "next-intl/server";

import { MembersListViewOrSetup } from "@/components/members/MembersListView";
import { loadAllianceMembers } from "@/lib/members/load";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("members");
  return { title: t("title") };
}

export default async function MembersPage() {
  const session = await requirePageSession("/members");

  if (!session.allianceTag) {
    return <MembersListViewOrSetup missingTag />;
  }

  let initial;
  try {
    initial = await loadAllianceMembers(session.id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load members";
    if (message.includes("Alliance tag")) {
      return <MembersListViewOrSetup missingTag />;
    }
    throw error;
  }

  return (
    <MembersListViewOrSetup
      initial={initial}
      canEditRanks={await sessionHasPermission(session.id, "members:write")}
    />
  );
}
