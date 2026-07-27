import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";

import { serializeTimeOffEntry } from "@/lib/time-off/api.shared";
import type { SerializedTimeOffEntry } from "@/lib/time-off/types.shared";
import { isTimeOffDate } from "./workflow.shared";
import { getDb, schema } from "@/lib/db";
import { getMonthKey, monthEndFromKey } from "@/lib/trains/game-time";

export async function listTimeOffRoster(allianceId: string) {
  return getDb().select({ id: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName })
    .from(schema.allianceMembers)
    .where(and(eq(schema.allianceMembers.allianceId, allianceId), ne(schema.allianceMembers.status, "former")))
    .orderBy(asc(schema.allianceMembers.currentName));
}

export async function listOwnTimeOffPage(input: {
  allianceId: string;
  ownedCommanderIds: string[];
  today: string;
  history: boolean;
  page: number;
  pageSize?: number;
}) {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 25, 25));
  if (input.ownedCommanderIds.length === 0) return { entries: [], hasMore: false };
  const rows = await getDb().select().from(schema.memberTimeOff)
    .where(and(
      eq(schema.memberTimeOff.allianceId, input.allianceId),
      inArray(schema.memberTimeOff.ashedMemberId, input.ownedCommanderIds),
      input.history
        ? or(lt(schema.memberTimeOff.endDate, input.today), isNotNull(schema.memberTimeOff.cancelledAt))
        : and(gte(schema.memberTimeOff.endDate, input.today), isNull(schema.memberTimeOff.cancelledAt)),
    ))
    .orderBy(input.history ? desc(schema.memberTimeOff.updatedAt) : asc(schema.memberTimeOff.startDate), asc(schema.memberTimeOff.id))
    .limit(pageSize + 1).offset(input.page * pageSize);
  return { entries: rows.slice(0, pageSize).map(serializeTimeOffEntry), hasMore: rows.length > pageSize };
}

export async function listActiveTimeOffEntries(input: {
  allianceId: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<SerializedTimeOffEntry[]> {
  const rows = await getDb()
    .select()
    .from(schema.memberTimeOff)
    .where(
      and(
        eq(schema.memberTimeOff.allianceId, input.allianceId),
        isNull(schema.memberTimeOff.cancelledAt),
        lte(schema.memberTimeOff.startDate, input.rangeEnd),
        gte(schema.memberTimeOff.endDate, input.rangeStart),
      ),
    )
    .orderBy(asc(schema.memberTimeOff.startDate), asc(schema.memberTimeOff.memberName));

  return rows.map(serializeTimeOffEntry);
}

export async function listTimeOffForMember(input: {
  allianceId: string;
  ashedMemberId: string;
  onOrAfter?: string;
}): Promise<SerializedTimeOffEntry[]> {
  const clauses = [
    eq(schema.memberTimeOff.allianceId, input.allianceId),
    eq(schema.memberTimeOff.ashedMemberId, input.ashedMemberId),
    isNull(schema.memberTimeOff.cancelledAt),
  ];
  if (input.onOrAfter) {
    clauses.push(gte(schema.memberTimeOff.endDate, input.onOrAfter));
  }

  const rows = await getDb()
    .select()
    .from(schema.memberTimeOff)
    .where(and(...clauses))
    .orderBy(asc(schema.memberTimeOff.startDate));

  return rows.map(serializeTimeOffEntry);
}

export async function findActiveTimeOffForMemberOnDate(input: {
  allianceId: string;
  ashedMemberId: string;
  date: string;
}): Promise<SerializedTimeOffEntry | null> {
  const rows = await getDb()
    .select()
    .from(schema.memberTimeOff)
    .where(
      and(
        eq(schema.memberTimeOff.allianceId, input.allianceId),
        eq(schema.memberTimeOff.ashedMemberId, input.ashedMemberId),
        isNull(schema.memberTimeOff.cancelledAt),
        lte(schema.memberTimeOff.startDate, input.date),
        gte(schema.memberTimeOff.endDate, input.date),
      ),
    )
    .orderBy(asc(schema.memberTimeOff.startDate))
    .limit(1);

  return rows[0] ? serializeTimeOffEntry(rows[0]) : null;
}

/** Persists the Ashed ExcusedRecord id(s) an entry was pushed to (or synced from). */
export async function setTimeOffEntryAshedExcusedIds(input: {
  allianceId: string;
  entryId: string;
  ashedExcusedIds: string[];
}) {
  await getDb()
    .update(schema.memberTimeOff)
    .set({
      ashedExcusedIds: input.ashedExcusedIds,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.memberTimeOff.id, input.entryId),
        eq(schema.memberTimeOff.allianceId, input.allianceId),
      ),
    );
}

export async function listUnexpectedAbsenceReport(input: {
  allianceId: string;
  asOfDate: string;
}): Promise<SerializedTimeOffEntry[]> {
  const rows = await getDb()
    .select()
    .from(schema.memberTimeOff)
    .where(
      and(
        eq(schema.memberTimeOff.allianceId, input.allianceId),
        eq(schema.memberTimeOff.entryKind, "unexpected"),
        isNull(schema.memberTimeOff.cancelledAt),
        lte(schema.memberTimeOff.startDate, input.asOfDate),
        gte(schema.memberTimeOff.endDate, input.asOfDate),
      ),
    )
    .orderBy(asc(schema.memberTimeOff.memberName));

  return rows.map(serializeTimeOffEntry);
}

export function monthRangeKeys(monthKey: string): {
  rangeStart: string;
  rangeEnd: string;
} {
  return {
    rangeStart: `${monthKey}-01`,
    rangeEnd: monthEndFromKey(monthKey),
  };
}

export async function loadTimeOffEntriesForMonth(
  allianceId: string,
  monthKey: string,
): Promise<SerializedTimeOffEntry[]> {
  const { rangeStart, rangeEnd } = monthRangeKeys(monthKey);
  return listActiveTimeOffEntries({ allianceId, rangeStart, rangeEnd });
}

export function resolveMonthKeyFromQuery(
  month: string | null | undefined,
  today: string,
): string {
  if (month && /^\d{4}-\d{2}$/.test(month) && isTimeOffDate(`${month}-01`)) {
    return month;
  }
  return getMonthKey(today);
}

export async function listLinkedCommanderIdsForHqUser(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<string[]> {
  const db = getDb();
  const [legacy, commanders] = await Promise.all([
    db.select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks)
      .where(and(eq(schema.hqMemberLinks.allianceId, input.allianceId), eq(schema.hqMemberLinks.hqUserId, input.hqUserId))),
    db.select({ ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId }).from(schema.hqUserCommanders)
      .innerJoin(schema.commanderAllianceMemberships, eq(schema.commanderAllianceMemberships.commanderId, schema.hqUserCommanders.commanderId))
      .where(and(
        eq(schema.hqUserCommanders.hqUserId, input.hqUserId),
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        eq(schema.commanderAllianceMemberships.status, "active"),
        isNull(schema.commanderAllianceMemberships.leftAt),
      )),
  ]);
  return [...new Set([...legacy, ...commanders].map((row) => row.ashedMemberId))];
}

export async function hqUserOwnsCommander(input: {
  allianceId: string;
  hqUserId: string;
  ashedMemberId: string;
}): Promise<boolean> {
  return (await listLinkedCommanderIdsForHqUser(input)).includes(input.ashedMemberId);
}

export async function findOverlappingEntries(input: {
  allianceId: string;
  ashedMemberId: string;
  startDate: string;
  endDate: string;
}): Promise<SerializedTimeOffEntry[]> {
  const rows = await getDb()
    .select()
    .from(schema.memberTimeOff)
    .where(
      and(
        eq(schema.memberTimeOff.allianceId, input.allianceId),
        eq(schema.memberTimeOff.ashedMemberId, input.ashedMemberId),
        isNull(schema.memberTimeOff.cancelledAt),
        lte(schema.memberTimeOff.startDate, input.endDate),
        gte(schema.memberTimeOff.endDate, input.startDate),
      ),
    );

  return rows.map(serializeTimeOffEntry);
}
