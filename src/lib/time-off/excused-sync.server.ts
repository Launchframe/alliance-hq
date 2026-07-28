import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { base44EntityPost, base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import type { MemberTimeOff } from "@/lib/db/schema";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { getAshedConnection } from "@/lib/session";
import {
  activityScopeToRecordTypes,
  groupParsedExcusedRecordsIntoEntries,
  parseAshedExcusedRecord,
} from "@/lib/time-off/excused-sync.shared";
import type { TimeOffActivityScope } from "@/lib/time-off/types.shared";
import { resolveAllianceAshedBotConnection } from "@/lib/vr/member-roster";

async function fetchAshedExcusedRecords(
  connection: ParsedConnection,
  ashedAllianceId: string,
  ashedMemberId: string,
): Promise<Record<string, unknown>[]> {
  try {
    const query = encodeURIComponent(
      JSON.stringify({
        alliance_id: ashedAllianceId,
        member_id: ashedMemberId,
      }),
    );
    const body = await base44Json<unknown>(
      connection,
      `/entities/ExcusedRecord?q=${query}`,
      { method: "GET" },
    );
    if (Array.isArray(body)) return body as Record<string, unknown>[];
    return [];
  } catch (error) {
    console.error(
      "[time-off] failed to fetch Ashed ExcusedRecord list",
      error,
    );
    return [];
  }
}

/** Active (non-matching-id) match wins; a cancelled-id match is reported so callers can skip it. */
function findMatchByAshedIds(
  rows: MemberTimeOff[],
  ashedExcusedIds: string[],
): { row: MemberTimeOff; isCancelled: boolean } | null {
  const idSet = new Set(ashedExcusedIds);
  const hasMatch = (row: MemberTimeOff) =>
    (row.ashedExcusedIds ?? []).some((id) => idSet.has(id));

  const active = rows.find((row) => row.cancelledAt == null && hasMatch(row));
  if (active) return { row: active, isCancelled: false };

  const cancelled = rows.find((row) => hasMatch(row));
  if (cancelled) return { row: cancelled, isCancelled: true };

  return null;
}

/**
 * Pulls this member's Ashed `ExcusedRecord` rows and upserts them into
 * `member_time_off`. A vs + donation pair sharing dates/reason ("All
 * Activities" in Ashed) collapses into one `activityScope: "all"` row.
 *
 * Rows already cancelled in HQ (`cancelledAt` set) for the same Ashed id(s)
 * are left alone — sync never resurrects an HQ-side cancellation.
 */
export async function syncMemberExcusedFromAshed(
  connection: ParsedConnection,
  allianceId: string,
  ashedAllianceId: string,
  ashedMemberId: string,
  memberName: string,
): Promise<void> {
  const rawRows = await fetchAshedExcusedRecords(
    connection,
    ashedAllianceId,
    ashedMemberId,
  );

  const parsed = rawRows
    .map((row) => parseAshedExcusedRecord(row))
    .filter((row): row is NonNullable<typeof row> => row != null)
    .filter(
      (row) =>
        (row.allianceId == null || row.allianceId === ashedAllianceId) &&
        (row.memberId == null || row.memberId === ashedMemberId),
    );

  if (parsed.length === 0) return;

  const grouped = groupParsedExcusedRecordsIntoEntries(parsed);

  const db = getDb();
  const existingRows = await db
    .select()
    .from(schema.memberTimeOff)
    .where(
      and(
        eq(schema.memberTimeOff.allianceId, allianceId),
        eq(schema.memberTimeOff.ashedMemberId, ashedMemberId),
      ),
    );

  const now = new Date();

  for (const entry of grouped) {
    const match = findMatchByAshedIds(existingRows, entry.ashedExcusedIds);

    if (match?.isCancelled) {
      // The member/officer cancelled this period in HQ; do not resurrect it.
      continue;
    }

    if (match) {
      await db
        .update(schema.memberTimeOff)
        .set({
          memberName,
          startDate: entry.startDate,
          endDate: entry.endDate,
          notes: entry.reason,
          activityScope: entry.activityScope,
          ashedExcusedIds: entry.ashedExcusedIds,
          updatedAt: now,
        })
        .where(eq(schema.memberTimeOff.id, match.row.id));
      continue;
    }

    await db.insert(schema.memberTimeOff).values({
      id: nanoid(),
      allianceId,
      ashedMemberId,
      memberName,
      startDate: entry.startDate,
      endDate: entry.endDate,
      notes: entry.reason,
      availability: "full_away",
      entryKind: "planned",
      // Ashed-originated rows come from ashed.online alliance-management tooling.
      source: "officer",
      activityScope: entry.activityScope,
      ashedExcusedIds: entry.ashedExcusedIds,
      createdAt: now,
      updatedAt: now,
    });
  }
}

type CreatedAshedRecord = { id?: string | number };

/**
 * Creates 1 (vs/donation) or 2 (all → vs + donation) `ExcusedRecord` rows in
 * Ashed. Returns the created ids in POST order; a partial failure still
 * returns whatever ids succeeded before the throw so the caller can persist
 * them (Ashed has no PUT, so a half-pushed "all" entry is still recoverable).
 */
export async function pushTimeOffEntryToAshed(input: {
  connection: ParsedConnection;
  ashedAllianceId: string;
  ashedMemberId: string;
  activityScope: TimeOffActivityScope;
  startDate: string;
  endDate: string;
  reason: string | null;
}): Promise<string[]> {
  const recordTypes = activityScopeToRecordTypes(input.activityScope);
  const ids: string[] = [];
  for (const recordType of recordTypes) {
    const created = (await base44EntityPost(
      input.connection,
      "ExcusedRecord",
      {
        record_type: recordType,
        start_date: input.startDate,
        end_date: input.endDate,
        reason: input.reason ?? "",
        alliance_id: input.ashedAllianceId,
        member_id: input.ashedMemberId,
      },
    )) as CreatedAshedRecord;
    if (created?.id != null) {
      ids.push(String(created.id));
    }
  }
  return ids;
}

/** Deletes each Ashed `ExcusedRecord` id — best-effort, continues past individual failures. */
export async function deleteTimeOffEntryFromAshed(
  connection: ParsedConnection,
  ashedExcusedIds: string[],
): Promise<void> {
  for (const id of ashedExcusedIds) {
    try {
      await base44Json(connection, `/entities/ExcusedRecord/${id}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error(
        `[time-off] failed to delete Ashed ExcusedRecord ${id}`,
        error,
      );
    }
  }
}

export type AshedSyncContext = {
  connection: ParsedConnection;
  ashedAllianceId: string;
};

/**
 * Resolves the Ashed sync context for a signed-in HQ web session, or null
 * when Ashed I/O should be skipped (native alliance, no Ashed link, or no
 * live Ashed session credential).
 */
export async function resolveWebAshedSyncContext(input: {
  allianceId: string;
  sessionId: string;
}): Promise<AshedSyncContext | null> {
  if (await isNativeAlliance(input.allianceId)) return null;
  const ashedAllianceId = await getAshedAllianceIdIfLinked(input.allianceId);
  if (!ashedAllianceId) return null;
  const connection = await getAshedConnection(input.sessionId);
  if (!connection) return null;
  return { connection, ashedAllianceId };
}

/**
 * Resolves the Ashed sync context for a Discord bot dual-write, or null when
 * Ashed I/O should be skipped (native alliance, no Ashed link, or no
 * alliance-level Ashed credential configured — the HQ row is kept either way).
 */
export async function resolveBotAshedSyncContext(
  allianceId: string,
): Promise<AshedSyncContext | null> {
  if (await isNativeAlliance(allianceId)) return null;
  const ashedAllianceId = await getAshedAllianceIdIfLinked(allianceId);
  if (!ashedAllianceId) return null;
  const connection = await resolveAllianceAshedBotConnection(allianceId);
  if (!connection) return null;
  return { connection, ashedAllianceId };
}
