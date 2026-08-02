import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import { base44Json } from "@/lib/base44/fetch";

export type AshedDateScoreRow = {
  id: string | null;
  memberId: string | null;
  memberName: string | null;
  score: number | string | null;
  rank: number | null;
  team: string | null;
  recordedDate: string | null;
};

/** Matches Ashed admin list calls in HAR (e.g. desert_storm_bulk_delete_scores). */
export const ASHED_SCORE_LIST_LIMIT = 2000;

export const ASHED_SCORE_LIST_FIELDS =
  "id,member_id,member_name,recorded_date,score,rank,team,event_id,board_key,hq_event_id,commendation_id,created_date";

export type RawAshedScoreRow = {
  id?: string;
  member_id?: string;
  member_name?: string | null;
  score?: number | string | null;
  rank?: number | null;
  team?: string | null;
  recorded_date?: string | null;
  event_id?: string | null;
  board_key?: string | null;
  hq_event_id?: string | null;
  commendation_id?: string | null;
};

function mapAshedScoreRow(row: RawAshedScoreRow): AshedDateScoreRow {
  return {
    id: row.id ?? null,
    memberId: row.member_id ?? null,
    memberName: row.member_name ?? null,
    score: row.score ?? null,
    rank: row.rank ?? null,
    team: row.team ?? null,
    recordedDate: row.recorded_date ?? null,
  };
}

export function buildAshedScoreListPath(input: {
  submitEntity: string;
  ashedAllianceId: string;
  eventId?: string | null;
  limit?: number;
  fields?: string;
}): string {
  const q: Record<string, string> = { alliance_id: input.ashedAllianceId };
  if (input.eventId) {
    q.event_id = input.eventId;
  }
  const params = new URLSearchParams();
  params.set("q", JSON.stringify(q));
  params.set("sort", "-recorded_date");
  params.set("limit", String(input.limit ?? ASHED_SCORE_LIST_LIMIT));
  params.set("fields", input.fields ?? ASHED_SCORE_LIST_FIELDS);
  return `/entities/${input.submitEntity}?${params.toString()}`;
}

export async function fetchAshedScoreRowsRaw(input: {
  connection: ParsedConnection;
  submitEntity: string;
  ashedAllianceId: string;
  eventId?: string | null;
  limit?: number;
  fields?: string;
}): Promise<RawAshedScoreRow[]> {
  const rows = await base44Json<RawAshedScoreRow[]>(
    input.connection,
    buildAshedScoreListPath({
      submitEntity: input.submitEntity,
      ashedAllianceId: input.ashedAllianceId,
      eventId: input.eventId,
      limit: input.limit,
      fields: input.fields,
    }),
  );
  return Array.isArray(rows) ? rows : [];
}

export function normalizeRecordedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length < 10) return null;
  return trimmed.slice(0, 10);
}

/** Fetch all score rows for an alliance entity (Ashed list API). */
export async function fetchAshedScoresForAlliance(
  connection: ParsedConnection,
  submitEntity: string,
  ashedAllianceId: string,
): Promise<AshedDateScoreRow[]> {
  const rows = await fetchAshedScoreRowsRaw({
    connection,
    submitEntity,
    ashedAllianceId,
  });
  return rows.map(mapAshedScoreRow);
}

export function filterAshedScoresByDate(
  rows: ReadonlyArray<AshedDateScoreRow>,
  recordedDate: string,
): AshedDateScoreRow[] {
  return rows.filter(
    (row) => normalizeRecordedDate(row.recordedDate) === recordedDate,
  );
}

export function groupAshedScoresByDate(
  rows: ReadonlyArray<AshedDateScoreRow>,
): Map<string, AshedDateScoreRow[]> {
  const map = new Map<string, AshedDateScoreRow[]>();
  for (const row of rows) {
    const date = normalizeRecordedDate(row.recordedDate);
    if (!date) continue;
    const bucket = map.get(date);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(date, [row]);
    }
  }
  return map;
}

export function countTeamsOnDate(rows: ReadonlyArray<AshedDateScoreRow>): {
  teamACount: number;
  teamBCount: number;
} {
  let teamACount = 0;
  let teamBCount = 0;
  for (const row of rows) {
    if (row.team === "A") teamACount += 1;
    else if (row.team === "B") teamBCount += 1;
  }
  return { teamACount, teamBCount };
}
