import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44BulkInsert,
  base44CallFunction,
  base44EntityPost,
} from "@/lib/base44/fetch";
import type { ScoreTargetDef } from "@/lib/video/score-targets";
import type { SubmitContext } from "@/lib/video/submit-schemas";

export type DispatchScoreSubmitOptions = {
  submitContext?: SubmitContext;
  /** Active+inactive roster size for Ashed bulkUpsertVSScores. */
  allianceSizeAtRecord?: number | null;
};

/**
 * Ashed VS uploads go through bulkUpsertVSScores (same as ashed.online), with
 * is_weekly so weekly totals are tagged. HQ does not interpolate missing daily
 * scores — Ashed owns that when officers upload in Ashed UI / on sync.
 */
export async function dispatchScoreSubmit(
  connection: ParsedConnection,
  target: ScoreTargetDef,
  payloads: Record<string, unknown>[],
  options?: DispatchScoreSubmitOptions,
): Promise<void> {
  if (payloads.length === 0) {
    return;
  }

  if (target.id === "vs-performance") {
    const recordedDate = options?.submitContext?.recordedDate;
    if (!recordedDate) {
      throw new Error("recordedDate is required for VSScore submit.");
    }
    const scores = payloads.map((row) => ({
      member_id: row.member_id,
      member_name: row.member_name,
      score: row.score,
      ...(row.rank != null ? { rank: row.rank } : {}),
    }));
    const allianceId = payloads[0]?.alliance_id;
    if (typeof allianceId !== "string" || !allianceId) {
      throw new Error("alliance_id is required for VSScore submit.");
    }
    const isWeekly = options?.submitContext?.vsPeriod === "weekly";
    await base44CallFunction(connection, "bulkUpsertVSScores", {
      alliance_id: allianceId,
      competition_id: recordedDate,
      recorded_date: recordedDate,
      alliance_size_at_record: options?.allianceSizeAtRecord ?? null,
      scores,
      unmatched: [],
      is_weekly: isWeekly,
    });
    return;
  }

  switch (target.submitMethod) {
    case "bulk":
      await base44BulkInsert(connection, target.submitEntity, payloads);
      return;
    case "row-post":
    case "upsert":
      for (const row of payloads) {
        await base44EntityPost(connection, target.submitEntity, row);
      }
      return;
    default:
      throw new Error(`Unsupported submit method: ${target.submitMethod}`);
  }
}
