import { getTranslations } from "next-intl/server";

import { MembersListViewOrSetup } from "@/components/members/MembersListView";
import { loadAllianceMembers } from "@/lib/members/load";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("members");
  return { title: t("title") };
}

export default async function MembersPage() {
  const session = await requirePageSession("/members");
  const hqAllianceId = session.currentAllianceId ?? session.allianceId;
  const nativeMode =
    hqAllianceId != null ? await isNativeAlliance(hqAllianceId) : false;

  if (!nativeMode && !session.allianceTag) {
    return <MembersListViewOrSetup missingTag />;
  }

  let initial;
  try {
    initial = await loadAllianceMembers(session.id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load members";
    if (message.includes("Alliance tag") || message.includes("No alliance")) {
      return <MembersListViewOrSetup missingTag />;
    }
    throw error;
  }

  const canWrite = await sessionHasPermission(session.id, "members:write");

  return (
    <MembersListViewOrSetup
      initial={initial}
      canEditRanks={canWrite}
      canImportMembers={canWrite && initial.operatingMode === "native"}
    />
  );
}
