import "server-only";

import { sessionHasPermission } from "@/lib/rbac/context";
import {
  TIME_OFF_READ_PERMISSION,
  TIME_OFF_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { loadAllianceMembers } from "@/lib/members/load";
import {
  listActiveTimeOffEntries,
  listLinkedCommanderIdsForHqUser,
  listUnexpectedAbsenceReport,
  loadTimeOffEntriesForMonth,
  resolveMonthKeyFromQuery,
} from "@/lib/time-off/repository.server";
import type { TimeOffCalendarPayload } from "@/lib/time-off/types.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export async function loadUnexpectedAbsenceReport(input: {
  sessionId: string;
  allianceId: string;
}) {
  const today = getServerCalendarDate();
  const [unexpected, plannedToday, roster] = await Promise.all([
    listUnexpectedAbsenceReport({ allianceId: input.allianceId, asOfDate: today }),
    listActiveTimeOffEntries({
      allianceId: input.allianceId,
      rangeStart: today,
      rangeEnd: today,
    }),
    loadAllianceMembers(input.sessionId),
  ]);

  const plannedMemberIds = new Set(
    plannedToday
      .filter(
        (entry) =>
          entry.entryKind === "planned" || entry.entryKind === "officer_marked",
      )
      .map((entry) => entry.ashedMemberId),
  );

  const unannounced = roster.members
    .filter((member) => member.status !== "former")
    .filter((member) => !plannedMemberIds.has(member.id))
    .map((member) => ({
      ashedMemberId: member.id,
      memberName: member.current_name,
    }));

  return { unexpected, unannounced };
}

export async function loadTimeOffCalendar(input: {
  sessionId: string;
  hqUserId: string | null;
  allianceId: string;
  month?: string | null;
}): Promise<TimeOffCalendarPayload | { forbidden: true }> {
  const canRead = await sessionHasPermission(
    input.sessionId,
    TIME_OFF_READ_PERMISSION,
  );
  if (!canRead) {
    return { forbidden: true };
  }

  const todayServerDate = getServerCalendarDate();
  const monthKey = resolveMonthKeyFromQuery(input.month, todayServerDate);
  const canManageOthers = await sessionHasPermission(
    input.sessionId,
    TIME_OFF_WRITE_PERMISSION,
  );

  const [entries, canWrite, linkedCommanderIds, unexpectedReport] =
    await Promise.all([
      loadTimeOffEntriesForMonth(input.allianceId, monthKey),
      sessionHasPermission(input.sessionId, TIME_OFF_WRITE_PERMISSION),
      input.hqUserId
        ? listLinkedCommanderIdsForHqUser({
            allianceId: input.allianceId,
            hqUserId: input.hqUserId,
          })
        : Promise.resolve([]),
      canManageOthers
        ? loadUnexpectedAbsenceReport({
            sessionId: input.sessionId,
            allianceId: input.allianceId,
          })
        : Promise.resolve(undefined),
    ]);

  return {
    todayServerDate,
    monthKey,
    entries,
    canWrite,
    canManageOthers,
    linkedCommanderIds,
    unexpectedReport,
  };
}
