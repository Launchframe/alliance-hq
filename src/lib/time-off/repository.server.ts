import "server-only";

import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  serializeTimeOffEntry,
  type TimeOffEntryPayload,
} from "@/lib/time-off/api.shared";
import type { SerializedTimeOffEntry } from "@/lib/time-off/types.shared";
import { getDb, schema } from "@/lib/db";
import { getMonthKey, monthEndFromKey } from "@/lib/trains/game-time";

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

export async function createTimeOffEntry(input: {
  allianceId: string;
  payload: TimeOffEntryPayload;
  createdByHqUserId?: string | null;
  createdByDiscordUserId?: string | null;
}) {
  const now = new Date();
  const [row] = await getDb()
    .insert(schema.memberTimeOff)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      ashedMemberId: input.payload.ashedMemberId.trim(),
      memberName: input.payload.memberName.trim(),
      startDate: input.payload.startDate,
      endDate: input.payload.endDate,
      notes: input.payload.notes?.trim() || null,
      availability: input.payload.availability ?? "full_away",
      entryKind: input.payload.entryKind ?? "planned",
      source: input.payload.source ?? "web",
      createdByHqUserId: input.createdByHqUserId ?? null,
      createdByDiscordUserId: input.createdByDiscordUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return row!;
}

export async function cancelTimeOffEntry(input: {
  allianceId: string;
  entryId: string;
}) {
  const [row] = await getDb()
    .update(schema.memberTimeOff)
    .set({
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.memberTimeOff.id, input.entryId),
        eq(schema.memberTimeOff.allianceId, input.allianceId),
        isNull(schema.memberTimeOff.cancelledAt),
      ),
    )
    .returning();

  return row ?? null;
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
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    return month;
  }
  return getMonthKey(today);
}

export async function listLinkedCommanderIdsForHqUser(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<string[]> {
  const rows = await getDb()
    .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
      ),
    );

  return rows.map((row) => row.ashedMemberId);
}

export async function hqUserOwnsCommander(input: {
  allianceId: string;
  hqUserId: string;
  ashedMemberId: string;
}): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.hqMemberLinks.id })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
        eq(schema.hqMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  return row != null;
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
