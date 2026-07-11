import { parseScoreNumber } from "@/lib/video/normalize-rows";
import type { ScoreTargetDef } from "@/lib/video/score-targets";

export type SubmitRowInput = {
  memberId: string;
  memberName: string;
  score: string;
  rank?: number | null;
};

export type SubmitContext = {
  eventId?: string;
  team?: "A" | "B";
  recordedDate: string;
  boardKey?: string;
  commendationId?: string;
  hqEventId?: string;
};

export function buildSubmitPayloads(
  target: ScoreTargetDef,
  allianceId: string,
  context: SubmitContext,
  rows: SubmitRowInput[],
  ashedEventId?: string,
): Record<string, unknown>[] {
  const eventId = ashedEventId ?? context.eventId;
  const recordedDate = context.recordedDate;

  switch (target.id) {
    case "desert-storm":
    case "canyon-storm":
      return rows.map((row) => ({
        alliance_id: allianceId,
        event_id: eventId,
        member_id: row.memberId,
        member_name: row.memberName,
        team: context.team ?? "A",
        score: parseScoreNumber(row.score),
        recorded_date: recordedDate,
      }));

    case "zombie-siege":
      return rows.map((row) => {
        const wavesSurvived = parseScoreNumber(row.score);
        return {
          alliance_id: allianceId,
          event_id: eventId,
          member_id: row.memberId,
          member_name: row.memberName,
          score: wavesSurvived,
          waves_survived: wavesSurvived,
          recorded_date: recordedDate,
        };
      });

    case "alliance-exercise":
      return rows.map((row) => ({
        alliance_id: allianceId,
        event_id: eventId,
        member_id: row.memberId,
        member_name: row.memberName,
        score: parseScoreNumber(row.score),
        recorded_date: recordedDate,
      }));

    case "donations":
      return rows.map((row) => ({
        alliance_id: allianceId,
        member_id: row.memberId,
        member_name: row.memberName,
        score: parseScoreNumber(row.score),
        recorded_date: recordedDate,
      }));

    case "vs-performance":
      return rows.map((row) => ({
        alliance_id: allianceId,
        member_id: row.memberId,
        member_name: row.memberName,
        // Ashed keys VS days by competition_id (same calendar date as recorded_date).
        competition_id: recordedDate,
        score: parseScoreNumber(row.score),
        rank: row.rank ?? null,
        recorded_date: recordedDate,
      }));

    case "frontline-breakthrough":
    case "seasonal":
    case "alliance-star":
      if (!eventId) {
        throw new Error("Ashed event_id is required for SeasonalScore submit.");
      }
      return rows.map((row) => ({
        alliance_id: allianceId,
        event_id: eventId,
        member_id: row.memberId,
        member_name: row.memberName,
        score: parseScoreNumber(row.score),
        recorded_date: recordedDate,
      }));

    default:
      throw new Error(`No submit payload builder for target: ${target.id}`);
  }
}

export function validateSubmitContext(
  target: ScoreTargetDef,
  context: SubmitContext,
  rowCount: number,
): string | null {
  for (const field of target.submitContext) {
    if (field === "eventId" && !context.eventId) {
      return "eventId is required.";
    }
    if (field === "team" && !context.team) {
      return "team is required.";
    }
    if (field === "recordedDate" && !context.recordedDate) {
      return "recordedDate is required.";
    }
    if (field === "boardKey" && !context.boardKey) {
      return "boardKey is required.";
    }
    if (field === "commendationId" && !context.commendationId) {
      return "commendationId is required.";
    }
    if (field === "hqEventId" && !context.hqEventId) {
      return "hqEventId is required.";
    }
  }

  if (target.maxSubmitRows != null && rowCount > target.maxSubmitRows) {
    return `At most ${target.maxSubmitRows} rows allowed for ${target.id}.`;
  }

  if (target.leaderboardModel === "podium-commendation") {
    return null;
  }

  return null;
}
