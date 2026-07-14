import {
  usesHqEventStore,
  type ScoreTargetDef,
} from "@/lib/video/score-targets";

/**
 * Whether submit must clear existing Ashed score rows for this target/context
 * before inserting the new batch.
 *
 * Storm-style targets: delete by event (+ team).
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
