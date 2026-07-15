import "server-only";

import { decryptSecret } from "@/lib/crypto/encrypt";
import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { DEFAULT_APP_ID } from "@/lib/connectionString";
import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { RollCandidate } from "@/lib/trains/types";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import { fetchLocalVsScores } from "@/lib/video/vs-fixture-submit.server";
import {
  getAllianceAshedCredential,
  getAllianceById,
} from "@/lib/vr/repository";

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
    const score = scoreValue(row);
    const previous = scores.get(memberId);
    if (previous == null || score > previous) {
      scores.set(memberId, score);
    }
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

function buildLegacyBotAshedConnection(): ParsedConnection | null {
  const token = process.env.VR_BOT_ASHED_BEARER_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    appId: process.env.BASE44_APP_ID?.trim() || DEFAULT_APP_ID,
    originUrl: process.env.BASE44_ORIGIN_URL?.trim() || "https://ashed.online",
  };
}

function legacyTokenAllowedForAlliance(allianceTag: string): boolean {
  const guardTag = process.env.VR_BOT_ASHED_ALLIANCE_TAG?.trim();
  if (!guardTag) return false;
  return allianceTag.trim().toLowerCase() === guardTag.trim().toLowerCase();
}

async function resolveAllianceAshedConnection(
  allianceId: string,
): Promise<{ connection: ParsedConnection; ashedAllianceId: string } | null> {
  const alliance = await getAllianceById(allianceId);
  const ashedAllianceId = alliance?.ashedAllianceId?.trim();
  if (!ashedAllianceId) return null;

  const credential = await getAllianceAshedCredential(allianceId);
  if (credential) {
    try {
      return {
        connection: {
          token: decryptSecret(credential.encryptedToken),
          appId: credential.appId,
          originUrl: credential.originUrl,
        },
        ashedAllianceId,
      };
    } catch (error) {
      console.error("[vs-scores] failed to decrypt alliance credential", error);
      return null;
    }
  }

  if (!alliance?.tag || !legacyTokenAllowedForAlliance(alliance.tag)) {
    return null;
  }

  const connection = buildLegacyBotAshedConnection();
  if (!connection) return null;
  return { connection, ashedAllianceId };
}

/** Prior-day VS scores keyed by roster member id (Ashed VSScore for recorded_date). */
export async function fetchAlliancePriorDayVsScoresByMember(
  allianceId: string,
  recordedDate: string,
): Promise<Map<string, number>> {
  if (isDevOrPreviewEnvironment()) {
    const local = await fetchLocalVsScores(allianceId, recordedDate);
    if (local.size > 0) return local;
  }

  const resolved = await resolveAllianceAshedConnection(allianceId);
  if (!resolved) return new Map();

  return fetchVsScoresByRecordedDate(
    resolved.connection,
    resolved.ashedAllianceId,
    recordedDate,
  );
}

/** VS scores for the calendar day before trainDate. */
export async function fetchAlliancePriorDayVsScoresForTrainDate(
  allianceId: string,
  trainDate: string,
): Promise<Map<string, number>> {
  return fetchAlliancePriorDayVsScoresByMember(
    allianceId,
    vsScoreReferenceDate(trainDate),
  );
}
