import {
  usesHqEventStore,
  type ScoreTargetDef,
} from "@/lib/video/score-targets";

/**
 * Native Ashed team-scoped storm uploads POST bulk rows only — no pre-delete
 * (see har/ashed.online-desert_storm_merge_uploads.har). HQ matches that;
 * use Data Management bulk delete to clear a date/team manually.
 */
export function usesAshedBulkOnlyStormUpload(target: ScoreTargetDef): boolean {
  return target.submitContext.includes("team");
}

/**
 * Whether submit must clear existing Ashed score rows for this target/context
 * before inserting the new batch.
 *
 * Team-scoped storm (Desert/Canyon): false — bulk insert only, like native Ashed.
 * Other event-scoped bulk targets: delete matching context before insert.
 * Date-keyed targets (VS, donations): delete by alliance + recorded_date —
 * otherwise a re-submit (Update scores) creates duplicate rows that sum to 2×.
 */
export function shouldReplaceAshedScoresOnSubmit(
  target: ScoreTargetDef,
  context: { eventId?: string | null },
): boolean {
  if (usesHqEventStore(target)) {
    return false;
  }

  if (usesAshedBulkOnlyStormUpload(target)) {
    return false;
  }

  if (
    target.eventEntity &&
    context.eventId &&
    target.submitMethod === "bulk"
  ) {
    return true;
  }

  if (
    !target.eventEntity &&
    (target.submitMethod === "bulk" || target.submitMethod === "upsert") &&
    target.submitContext.includes("recordedDate")
  ) {
    return true;
  }

  return false;
}
