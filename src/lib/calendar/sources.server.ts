import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { schema } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate, getServerDayOfWeek } from "@/lib/trains/game-time";
import { serverTimestampFromCalendarAndTime } from "@/lib/eur/schedule-engine";
import { expandBiweeklySlotsToDates, expandOneShotDatesInRange, expandWeeklySlotsToDates } from "@/lib/regular-events/schedule-validation.shared";
import { isRegularEventKey } from "@/lib/regular-events/catalog.shared";
import type { RegularEventWeeklySlot } from "@/lib/regular-events/types.shared";
import { readPlanDashboard } from "@/lib/plunder-plan/service.server";
import { loadBoard } from "@/lib/support-teams/repository.server";
import { draftKey } from "@/lib/support-teams/draft.shared";
import { readField } from "@/lib/support-teams/policy.shared";
import { calendarSourcePermission, type CalendarPrincipal, type CalendarTx } from "./access.server";
import { CalendarError, type CalendarEvent, type CalendarPreferences, type CalendarSource } from "./types.shared";

export async function calendarEvents(tx: CalendarTx, principal: CalendarPrincipal, preferences: CalendarPreferences, selected: CalendarSource[], now = new Date(), window?: { from: Date; until: Date }): Promise<CalendarEvent[]> {
  const t = await getTranslations({ locale: preferences.locale, namespace: "calendarConnections" });
  const allianceId = principal.allianceId, from = window?.from ?? new Date(now.getTime() - 86_400_000), until = window?.until ?? new Date(now.getTime() + 90 * 86_400_000);
  const fromDate = getServerCalendarDate(from), untilDate = getServerCalendarDate(until);
  const allowed = (source: CalendarSource) => selected.includes(source) && (!calendarSourcePermission[source] || principal.permissions.has(calendarSourcePermission[source]!));
  const events: CalendarEvent[] = [];
  const push = (source: CalendarSource, key: string, start: string, end: string, allDay = false, title = t(`sources.${source}`), description = "") => {
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || end <= start) throw new CalendarError("invalid_source", 503);
    if (Date.parse(end) <= from.getTime() || Date.parse(start) >= until.getTime()) return;
    const path = { regular: "/settings/regular-events", battle: "/battle-plan", boarding: "/trains", plunder: "/plunder-plan", teams: "/support-teams", timeOff: "/time-off" }[source];
    events.push({ source, key: `${source}:${key}`, start, end, allDay, title, description, path, locale: preferences.locale, alerts: [...preferences.alerts] });
  };
  if (allowed("regular")) {
    const rules = await tx.select().from(schema.regularEventScheduleRules).where(and(eq(schema.regularEventScheduleRules.allianceId, allianceId), eq(schema.regularEventScheduleRules.active, 1)));
    for (const rule of rules) {
      if (!isRegularEventKey(rule.eventKey)) continue;
      const slots = rule.weeklySlots as RegularEventWeeklySlot[] | null;
      let dates: string[] = [];
      if (rule.scheduleKind === "weekly" && slots) dates = expandWeeklySlotsToDates(slots, fromDate, untilDate);
      if (rule.scheduleKind === "biweekly" && slots && rule.biweeklyPhaseMonday) dates = expandBiweeklySlotsToDates(slots, rule.biweeklyPhaseMonday, fromDate, untilDate);
      if (rule.scheduleKind === "once") dates = expandOneShotDatesInRange((rule.oneShotDates as string[] | null) ?? [], fromDate, untilDate);
      if (rule.scheduleKind === "interval_after_last" && rule.intervalDays && rule.intervalDays > 0) {
        const [last] = await tx.select().from(schema.regularEventOccurrences).where(and(eq(schema.regularEventOccurrences.allianceId, allianceId), eq(schema.regularEventOccurrences.scheduleRuleId, rule.id))).orderBy(desc(schema.regularEventOccurrences.scheduledStartAt)).limit(1);
        if (last) {
          let date = last.occurrenceDate;
          while (date > fromDate) date = addCalendarDays(date, -rule.intervalDays);
          while (date < fromDate) date = addCalendarDays(date, rule.intervalDays);
          for (; date <= untilDate; date = addCalendarDays(date, rule.intervalDays)) dates.push(date);
        }
      }
      for (const date of dates) {
        const clock = slots?.find((slot) => slot.dow === getServerDayOfWeek(date))?.timeSt ?? rule.anchorTimeSt;
        if (!clock) continue;
        const start = serverTimestampFromCalendarAndTime(date, clock);
        push("regular", `${rule.id}:${date}`, start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString(), false, t(`regular.${rule.eventKey}`));
      }
    }
  }
  if (allowed("battle")) {
    const rows = await tx.select({ id: schema.battlePlanCaptureEvents.id, start: schema.battlePlanCaptureEvents.scheduledAt }).from(schema.battlePlanCaptureEvents).where(and(eq(schema.battlePlanCaptureEvents.allianceId, allianceId), eq(schema.battlePlanCaptureEvents.status, "scheduled"), gte(schema.battlePlanCaptureEvents.scheduledAt, from), lte(schema.battlePlanCaptureEvents.scheduledAt, until)));
    for (const row of rows) push("battle", row.id, row.start.toISOString(), new Date(row.start.getTime() + 30 * 60_000).toISOString());
  }
  if (allowed("boarding")) {
    const rows = await tx.select({ window: schema.trainBoardingWindows, lockAt: schema.trainConductorRecords.lockedAt }).from(schema.trainBoardingWindows)
      .innerJoin(schema.trainConductorRecords, and(eq(schema.trainConductorRecords.id, schema.trainBoardingWindows.recordId), eq(schema.trainConductorRecords.allianceId, schema.trainBoardingWindows.allianceId)))
      .where(and(eq(schema.trainBoardingWindows.allianceId, allianceId), eq(schema.trainBoardingWindows.status, "active"), gte(schema.trainBoardingWindows.endsAt, now)));
    for (const { window, lockAt } of rows) if (window.startsAt && window.endsAt && lockAt?.getTime() === window.lockAt.getTime()) push("boarding", window.recordId, window.startsAt.toISOString(), window.endsAt.toISOString(), false, t("boarding.title"), window.basis === "estimated" ? t("boarding.estimate") : "");
  }
  if (allowed("plunder")) {
    const identity = { principalId: `hq:${principal.hqUserId}`, aliases: principal.aliases, memberIds: principal.memberIds, canSuggest: false, canManageSelf: false };
    for (let start = from.getTime(); start < until.getTime(); start += 28 * 86_400_000) {
      const result = await readPlanDashboard(tx, allianceId, identity, new Date(start).toISOString(), new Date(Math.min(until.getTime(), start + 28 * 86_400_000)).toISOString());
      for (const occurrence of result.occurrences.filter((row) => row.kind === "plan" && row.owned)) push("plunder", `${occurrence.planId}:${occurrence.key}`, occurrence.startAt, occurrence.endAt);
    }
  }
  if (allowed("teams")) {
    const board = await loadBoard(tx, allianceId);
    if (board.construction?.kind === "draft") {
      const id = board.construction.id, status = readField(board, draftKey(id, "status"));
      if (status === "open" || status === "ready") push("teams", id, String(readField(board, draftKey(id, "startsAt"))), String(readField(board, draftKey(id, "endsAt"))));
    }
  }
  if (allowed("timeOff") && principal.memberIds.length) {
    const rows = await tx.select({ id: schema.memberTimeOff.id, start: schema.memberTimeOff.startDate, end: schema.memberTimeOff.endDate }).from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.allianceId, allianceId), inArray(schema.memberTimeOff.ashedMemberId, principal.memberIds), inArray(schema.memberTimeOff.entryKind, ["planned", "officer_marked"]), eq(schema.memberTimeOff.globalAbsence, true), isNull(schema.memberTimeOff.cancelledAt), lte(schema.memberTimeOff.startDate, untilDate), gte(schema.memberTimeOff.endDate, fromDate)));
    for (const row of rows) push("timeOff", row.id, row.start, addCalendarDays(row.end, 1), true);
  }
  const unique = [...new Map(events.map((event) => [event.key, event])).values()].sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
  if (unique.length > 2000) throw new CalendarError("too_many_events", 503);
  return unique;
}
