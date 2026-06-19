import "server-only";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { RollCandidate } from "@/lib/trains/types";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

type AshedVsScoreRow = {
  id?: string;
  member_id?: string;
  memberId?: string;
  member_name?: string;
  memberName?: string;
  current_name?: string;
  score?: number;
  points?: number;
  total?: number;
  recorded_date?: string;
};

function memberIdFromRow(row: AshedVsScoreRow): string | null {
  const memberId = row.member_id ?? row.memberId ?? row.id;
  return memberId ? String(memberId) : null;
}

function scoreValue(row: AshedVsScoreRow): number {
  return Number(row.score ?? row.points ?? row.total ?? 0);
}

function memberFromScore(row: AshedVsScoreRow): RollCandidate | null {
  const memberId = memberIdFromRow(row);
  const memberName =
    row.member_name ?? row.memberName ?? row.current_name ?? null;
  if (!memberId || !memberName) return null;
  return { memberId, memberName: String(memberName) };
}

async function fetchVsScoreRowsForRecordedDate(
  connection: ParsedConnection,
  allianceId: string,
  recordedDate: string,
): Promise<AshedVsScoreRow[]> {
  const path = `/entities/VSScore?q=${encodeURIComponent(
    JSON.stringify({
      alliance_id: allianceId,
      recorded_date: recordedDate,
    }),
  )}&sort=-score`;
  return base44Json<AshedVsScoreRow[]>(connection, path);
}

export async function fetchVsScoresByRecordedDate(
  connection: ParsedConnection,
  allianceId: string,
  recordedDate: string,
): Promise<Map<string, number>> {
  const rows = await fetchVsScoreRowsForRecordedDate(
    connection,
    allianceId,
    recordedDate,
  );
  const scores = new Map<string, number>();
  for (const row of rows) {
    const memberId = memberIdFromRow(row);
    if (!memberId) continue;
    scores.set(memberId, scoreValue(row));
  }
  return scores;
}

export async function fetchVsTopScorersForRecordedDate(
  connection: ParsedConnection,
  allianceId: string,
  recordedDate: string,
  limit: number,
): Promise<RollCandidate[]> {
  const rows = await fetchVsScoreRowsForRecordedDate(
    connection,
    allianceId,
    recordedDate,
  );
  return rows
    .map((row) => ({ row, score: scoreValue(row) }))
    .filter(
      (entry): entry is { row: AshedVsScoreRow; score: number } =>
        memberFromScore(entry.row) != null,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => memberFromScore(entry.row)!);
}

export async function fetchVsTopScorersForTrainDate(
  connection: ParsedConnection,
  allianceId: string,
  trainDate: string,
  limit: number,
): Promise<RollCandidate[]> {
  return fetchVsTopScorersForRecordedDate(
    connection,
    allianceId,
    vsScoreReferenceDate(trainDate),
    limit,
  );
}

export async function fetchVsTotalsForDateRange(
  connection: ParsedConnection,
  allianceId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  let cursor = startDate;

  while (cursor <= endDate) {
    const dayScores = await fetchVsScoresByRecordedDate(
      connection,
      allianceId,
      cursor,
    );
    for (const [memberId, score] of dayScores) {
      totals.set(memberId, (totals.get(memberId) ?? 0) + score);
    }
    cursor = addCalendarDays(cursor, 1);
  }

  return totals;
}
