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

type RawAshedScoreRow = {
  id?: string;
  member_id?: string;
  member_name?: string | null;
  score?: number | string | null;
  rank?: number | null;
  team?: string | null;
  recorded_date?: string | null;
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
  const q = encodeURIComponent(JSON.stringify({ alliance_id: ashedAllianceId }));
  const rows = await base44Json<RawAshedScoreRow[]>(
    connection,
    `/entities/${submitEntity}?q=${q}&sort=-recorded_date&limit=5000`,
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.map(mapAshedScoreRow);
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
