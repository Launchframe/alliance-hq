import { getTranslations } from "next-intl/server";

import { ConductorHistoryImportClient } from "@/components/trains/ConductorHistoryImportClient";
import { loadAllianceGameRoster } from "@/lib/members/game-roster";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { resolveHqAllianceIdFromSession } from "@/lib/members/resolve-hq-alliance";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("trains.historyImport");
  return { title: t("pageTitle") };
}

export default async function TrainsHistoryImportPage() {
  const session = await requirePageSession("/trains/history-import");
  await requirePagePermission(session.id, "trains:write", "/trains");

  const allianceId = await resolveHqAllianceIdFromSession(session.id);
  const rosterRows = allianceId
    ? await loadAllianceGameRoster({ allianceId })
    : [];

  const roster = rosterRows.map((member) => ({
    memberId: member.id,
    memberName: member.current_name,
    inactive: member.status === "former",
  }));

  return (
    <ConductorHistoryImportClient
      today={getServerCalendarDate()}
      roster={roster}
    />
  );
}
