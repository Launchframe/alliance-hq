import "server-only";

import { decryptSecret } from "@/lib/crypto/encrypt";
import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { DEFAULT_APP_ID } from "@/lib/connectionString";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { RollCandidate } from "@/lib/trains/types";
import { priorDayVsAppliesForTrainDate } from "@/lib/trains/vs-data-status.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import type { VsDay6Coverage } from "@/lib/video/vs-day6-derivation.shared";
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
  /** Weekly week-ending totals (Sunday). Must not feed daily train wheels. */
  is_weekly?: boolean;
  isWeekly?: boolean;
};

/** Weekly VS totals share Sunday `recorded_date` but are not daily match scores. */
function isWeeklyVsScoreRow(row: AshedVsScoreRow): boolean {
  return row.is_weekly === true || row.isWeekly === true;
}

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
  const priorDayVsScore = scoreValue(row);
  return {
    memberId,
    memberName: String(memberName),
    ...(priorDayVsScore > 0 ? { priorDayVsScore } : {}),
  };
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
  const rows = await base44Json<AshedVsScoreRow[]>(connection, path);
  // Weekly uploads use Sunday recorded_date + is_weekly. Train Top VS / PIF need
  // daily match scores only — never week totals (Monday T−1 would otherwise spin
  // from the prior week's leaderboard).
  return rows.filter((row) => !isWeeklyVsScoreRow(row));
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
  // Keep max score per member (Ashed may return duplicate rows on re-upload).
  const bestByMember = new Map<string, RollCandidate>();
  for (const row of rows) {
    const candidate = memberFromScore(row);
    if (!candidate) continue;
    const previous = bestByMember.get(candidate.memberId);
    const score = candidate.priorDayVsScore ?? 0;
    const previousScore = previous?.priorDayVsScore ?? 0;
    if (!previous || score > previousScore) {
      bestByMember.set(candidate.memberId, candidate);
    }
  }
  return [...bestByMember.values()]
    .sort((a, b) => (b.priorDayVsScore ?? 0) - (a.priorDayVsScore ?? 0))
    .slice(0, limit);
}

export async function fetchVsTopScorersForTrainDate(
  connection: ParsedConnection,
  allianceId: string,
  trainDate: string,
  limit: number,
): Promise<RollCandidate[]> {
  // Sunday is the VS break — Monday trains have no prior-day daily scores.
  if (!priorDayVsAppliesForTrainDate(trainDate)) {
    return [];
  }
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

/**
 * Per-member Days 1–5 (Mon–Fri) VSScore total and how many of those five days
 * had a row, for the week ending in `day6RecordedDate` (Saturday). Used to
 * derive the true Day 6 delta from a cumulative post-match screenshot.
 */
export async function fetchAllianceVsDay1To5CoverageForDay6(
  allianceId: string,
  day6RecordedDate: string,
): Promise<Map<string, VsDay6Coverage>> {
  const resolved = await resolveAllianceAshedConnection(allianceId);
  if (!resolved) return new Map();

  const coverage = new Map<string, VsDay6Coverage>();
  let cursor = addCalendarDays(day6RecordedDate, -5);
  const friday = addCalendarDays(day6RecordedDate, -1);

  while (cursor <= friday) {
    const dayScores = await fetchVsScoresByRecordedDate(
      resolved.connection,
      resolved.ashedAllianceId,
      cursor,
    );
    for (const [memberId, score] of dayScores) {
      const prev = coverage.get(memberId) ?? { total: 0, daysCovered: 0 };
      coverage.set(memberId, {
        total: prev.total + score,
        daysCovered: prev.daysCovered + 1,
      });
    }
    cursor = addCalendarDays(cursor, 1);
  }

  return coverage;
}

/** Daily VS scores keyed by roster member id (Ashed VSScore for recorded_date). */
export async function fetchAlliancePriorDayVsScoresByMember(
  allianceId: string,
  recordedDate: string,
): Promise<Map<string, number>> {
  const resolved = await resolveAllianceAshedConnection(allianceId);
  if (!resolved) return new Map();

  return fetchVsScoresByRecordedDate(
    resolved.connection,
    resolved.ashedAllianceId,
    recordedDate,
  );
}

/**
 * Top prior-day Ashed VS scorers for a train date (T−1 `recorded_date`).
 * Used by `vs_high_score` / `vs_top_10` conductor rolls — not season VR.
 * Intersects Ashed scores with the active HQ roster (excludes `former`), matching
 * Top VR's `fetchNativeVrTopScorers` so departed members cannot win the wheel.
 * Empty when T−1 is the Sunday VS break (weekly totals are not used).
 */
export async function fetchAllianceVsTopScorersForTrainDate(
  allianceId: string,
  trainDate: string,
  limit: number,
): Promise<RollCandidate[]> {
  if (limit <= 0) return [];

  if (!priorDayVsAppliesForTrainDate(trainDate)) {
    return [];
  }
  const resolved = await resolveAllianceAshedConnection(allianceId);
  if (!resolved) return [];

  const [activeMembers, scores] = await Promise.all([
    listActiveAllianceMembersForPool(allianceId),
    fetchVsScoresByRecordedDate(
      resolved.connection,
      resolved.ashedAllianceId,
      vsScoreReferenceDate(trainDate),
    ),
  ]);

  const activeById = new Map(
    activeMembers.map((member) => [member.ashedMemberId, member]),
  );

  return [...scores.entries()]
    .filter(([memberId, score]) => score > 0 && activeById.has(memberId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([memberId, score]) => {
      const member = activeById.get(memberId)!;
      return {
        memberId,
        memberName: member.currentName,
        allianceRank: member.allianceRank ?? null,
        priorDayVsScore: score,
      };
    });
}

/**
 * VS totals for conductor-minimum evaluation over `periodStart`…`periodEnd`
 * (inclusive). Single-day periods use that day's daily Ashed VSScore; multi-day
 * periods sum daily scores (never weekly `is_weekly` totals).
 */
export async function fetchAllianceVsScoresForEvaluationPeriod(
  allianceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, number>> {
  const resolved = await resolveAllianceAshedConnection(allianceId);
  if (!resolved) return new Map();

  if (periodStart === periodEnd) {
    return fetchVsScoresByRecordedDate(
      resolved.connection,
      resolved.ashedAllianceId,
      periodStart,
    );
  }

  return fetchVsTotalsForDateRange(
    resolved.connection,
    resolved.ashedAllianceId,
    periodStart,
    periodEnd,
  );
}

/** Daily VS scores for the calendar day before trainDate (never weekly totals). */
export async function fetchAlliancePriorDayVsScoresForTrainDate(
  allianceId: string,
  trainDate: string,
): Promise<Map<string, number>> {
  if (!priorDayVsAppliesForTrainDate(trainDate)) {
    return new Map();
  }
  return fetchAlliancePriorDayVsScoresByMember(
    allianceId,
    vsScoreReferenceDate(trainDate),
  );
}
