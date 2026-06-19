import "server-only";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import type { RollCandidate } from "@/lib/trains/types";
import { fetchVsTopScorersForTrainDate } from "@/lib/trains/vs-scores.server";

type AshedScoreRow = {
  id?: string;
  member_id?: string;
  memberId?: string;
  member_name?: string;
  memberName?: string;
  current_name?: string;
  score?: number;
  points?: number;
  total?: number;
};

/** Ashed entity per event key — extend when meteorite vs capitol diverge. */
const ENTITY_BY_EVENT_KEY: Record<string, string> = {
  capitol_war: "KillScore",
  meteorite_war: "KillScore",
};

function memberFromScore(row: AshedScoreRow): RollCandidate | null {
  const memberId = row.member_id ?? row.memberId ?? row.id;
  const memberName =
    row.member_name ?? row.memberName ?? row.current_name ?? null;
  if (!memberId || !memberName) return null;
  return { memberId: String(memberId), memberName: String(memberName) };
}

function scoreValue(row: AshedScoreRow): number {
  return Number(row.score ?? row.points ?? row.total ?? 0);
}

export function ashedEntityForEventKey(eventKey: string): string {
  return ENTITY_BY_EVENT_KEY[eventKey] ?? "VSScore";
}

export async function fetchEventTopScorers(
  connection: ParsedConnection,
  allianceId: string,
  eventKey: string,
  trainDate: string,
  limit: number,
): Promise<RollCandidate[]> {
  const entity = ashedEntityForEventKey(eventKey);
  if (entity === "VSScore") {
    return fetchVsTopScorersForTrainDate(
      connection,
      allianceId,
      trainDate,
      limit,
    );
  }

  const path = `/entities/${entity}?q=${encodeURIComponent(
    JSON.stringify({ alliance_id: allianceId }),
  )}&sort=-score&limit=${limit}`;
  const rows = await base44Json<AshedScoreRow[]>(connection, path);
  return rows
    .map((row) => ({ row, score: scoreValue(row) }))
    .filter(
      (entry): entry is { row: AshedScoreRow; score: number } =>
        memberFromScore(entry.row) != null,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => memberFromScore(entry.row)!);
}
