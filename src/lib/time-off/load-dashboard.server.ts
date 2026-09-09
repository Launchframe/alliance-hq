import "server-only";

import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { TIME_OFF_READ_PERMISSION, TIME_OFF_WRITE_PERMISSION } from "@/lib/rbac/constants";
import {
  listLinkedCommanderIdsForHqUser,
  listOwnTimeOffPage,
  listTimeOffRoster,
  listUnexpectedAbsenceReport,
  loadTimeOffEntriesForMonth,
  resolveMonthKeyFromQuery,
} from "./repository.server";
import type { TimeOffCalendarPayload } from "./types.shared";
import { timeOffEntryForViewer } from "./workflow.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { isAshedTimeOffSyncEnabled } from "./excused-actions.server";

export async function loadUnexpectedAbsenceReport(input: { sessionId: string; allianceId: string }) {
  const canManage = await sessionHasPermissionForAlliance(input.sessionId, input.allianceId, TIME_OFF_WRITE_PERMISSION);
  if (!canManage) return { unexpected: [], unannounced: [] };
  return {
    unexpected: await listUnexpectedAbsenceReport({ allianceId: input.allianceId, asOfDate: getServerCalendarDate() }),
    unannounced: [],
  };
}

export async function loadTimeOffCalendar(input: {
  sessionId: string;
  hqUserId: string | null;
  allianceId: string;
  month?: string | null;
  history?: boolean;
  page?: number;
}): Promise<TimeOffCalendarPayload | { forbidden: true }> {
  if (!input.hqUserId || !(await sessionHasPermissionForAlliance(input.sessionId, input.allianceId, TIME_OFF_READ_PERMISSION))) return { forbidden: true };
  const todayServerDate = getServerCalendarDate();
  const monthKey = resolveMonthKeyFromQuery(input.month, todayServerDate);
  const [canManageOthers, linkedCommanderIds, roster, entries] = await Promise.all([
    sessionHasPermissionForAlliance(input.sessionId, input.allianceId, TIME_OFF_WRITE_PERMISSION),
    listLinkedCommanderIdsForHqUser({ allianceId: input.allianceId, hqUserId: input.hqUserId }),
    listTimeOffRoster(input.allianceId),
    loadTimeOffEntriesForMonth(input.allianceId, monthKey),
  ]);
  const page = Number.isSafeInteger(input.page) && input.page! >= 0 ? Math.min(input.page!, 1000) : 0;
  const own = await listOwnTimeOffPage({ allianceId: input.allianceId, ownedCommanderIds: linkedCommanderIds, today: todayServerDate, history: input.history === true, page });
  const viewer = { canManageOthers, ownedCommanderIds: linkedCommanderIds };
  return {
    todayServerDate,
    monthKey,
    entries: entries.map((entry) => timeOffEntryForViewer(entry, viewer)),
    canWrite: canManageOthers || linkedCommanderIds.length > 0,
    canManageOthers,
    linkedCommanderIds,
    commanders: canManageOthers ? roster : roster.filter((member) => linkedCommanderIds.includes(member.id)),
    ownEntries: own.entries,
    ownEntriesPage: page,
    ownEntriesHaveMore: own.hasMore,
    history: input.history === true,
    ashedSyncEnabled: await isAshedTimeOffSyncEnabled(input.allianceId),
    unexpectedReport: canManageOthers ? await loadUnexpectedAbsenceReport(input) : undefined,
  };
}
