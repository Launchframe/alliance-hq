import {
  EVENT_EVIDENCE_KINDS,
  EVENT_LEGACY_LEADERBOARD_CREDIT,
  EVENT_POLL_NO_CREDIT,
  EVENT_POLL_YES_CREDIT,
  type EventEvidenceKind,
  type EventProvenanceKind,
} from "@/lib/hq-events/event-types.shared";

/**
 * Canonical merge (plan §5): resolve the active reviewed observations for
 * one event+board+member into a single result, independent of arrival order.
 *
 * Ordering rules:
 *  1. Retracted / superseded observations are ignored; a duplicated source
 *     fingerprint contributes one claim.
 *  2. Identical real-score tuples collapse. Different real tuples are a
 *     conflict — never repaired by taking a maximum.
 *  3. A resolved real result is authoritative; a contradictory No claim is
 *     retained as a warning, never replaces the score.
 *  4. Otherwise a confirmed legacy leaderboard marker establishes
 *     participation with unknown points.
 *  5. Otherwise consistent Yes → yes-only; No-only → explicit No; Yes+No →
 *     conflict requiring review.
 *  6. No observations → no evidence (never an implied No).
 *  7. Manual corrections carry actor + reason, never OCR provenance.
 */

export type EventObservation = {
  /** Observation identity; used for supersession links. */
  id: string;
  memberId: string;
  kind: EventEvidenceKind;
  /** Canonical decimal string; null for poll rows / score-less claims. */
  realScore: string | null;
  stage: number | null;
  observedRank: number | null;
  provenance: EventProvenanceKind;
  /** Stable fingerprint of the source row; duplicates collapse. */
  sourceKey?: string | null;
  retracted?: boolean;
  /** Id of the observation that supersedes this one. */
  supersededBy?: string | null;
  /** Manual corrections always carry an actor and a reason. */
  correction?: { actorId: string; reason: string } | null;
};

export type EventEvidenceClass =
  | "real"
  | "legacy_leaderboard"
  | "yes_only"
  | "explicit_no"
  | "conflict"
  | "none";

export type EventMergeConflict = "real_score_mismatch" | "poll_yes_no";

export type ResolvedEventMember = {
  memberId: string;
  class: EventEvidenceClass;
  /** Present only for class `real`. Canonical decimal string. */
  score: string | null;
  stage: number | null;
  observedRank: number | null;
  conflict: EventMergeConflict | null;
  /** Non-authoritative evidence kept as review warnings (e.g. a No under a real). */
  retainedWarnings: EventEvidenceKind[];
  corrections: Array<{ actorId: string; reason: string }>;
  /** Distinct conflicting real tuples when class === 'conflict'. */
  conflictingScores?: string[];
};

function realTupleKey(observation: EventObservation): string {
  return `${observation.realScore}|${observation.stage ?? ""}`;
}

export function resolveEventMemberEvidence(
  memberId: string,
  observations: readonly EventObservation[],
): ResolvedEventMember {
  const base: ResolvedEventMember = {
    memberId,
    class: "none",
    score: null,
    stage: null,
    observedRank: null,
    conflict: null,
    retainedWarnings: [],
    corrections: [],
  };

  // 1. Drop retracted and superseded; collapse duplicate source fingerprints.
  const supersededIds = new Set(
    observations
      .map((observation) => observation.supersededBy && observation.id)
      .filter(Boolean) as string[],
  );
  const seenSources = new Set<string>();
  const active: EventObservation[] = [];
  const corrections: Array<{ actorId: string; reason: string }> = [];
  for (const observation of observations) {
    if (observation.retracted || supersededIds.has(observation.id)) continue;
    if (observation.sourceKey != null) {
      if (seenSources.has(observation.sourceKey)) continue;
      seenSources.add(observation.sourceKey);
    }
    active.push(observation);
    if (observation.correction) corrections.push(observation.correction);
  }
  base.corrections = corrections;
  if (active.length === 0) return base;

  const warnings = (exclude: EventEvidenceKind[]): EventEvidenceKind[] =>
    [
      ...new Set(
        active
          .map((observation) => observation.kind)
          .filter((kind) => !exclude.includes(kind)),
      ),
    ].sort((a, b) => EVENT_EVIDENCE_KINDS.indexOf(a) - EVENT_EVIDENCE_KINDS.indexOf(b));

  // 2. Real tuples: identical collapse; differing tuples conflict.
  const realObservations = active.filter(
    (observation) =>
      observation.kind === "leaderboard" && observation.realScore != null,
  );
  const tupleToObservation = new Map<string, EventObservation>();
  for (const observation of realObservations) {
    const key = realTupleKey(observation);
    if (!tupleToObservation.has(key)) tupleToObservation.set(key, observation);
  }
  const distinctTuples = [...tupleToObservation.entries()];
  if (distinctTuples.length > 1) {
    return {
      ...base,
      class: "conflict",
      conflict: "real_score_mismatch",
      conflictingScores: distinctTuples
        .map(([, observation]) => observation.realScore!)
        .sort(),
      retainedWarnings: warnings(["leaderboard"]),
    };
  }
  if (distinctTuples.length === 1) {
    const [, real] = distinctTuples[0]!;
    return {
      ...base,
      class: "real",
      score: real.realScore,
      stage: real.stage,
      observedRank: real.observedRank,
      retainedWarnings: warnings(["leaderboard"]),
    };
  }

  // 4. Confirmed legacy leaderboard participation, points unknown.
  const hasLegacy = active.some(
    (observation) => observation.kind === "legacy_leaderboard",
  );
  // A leaderboard row reviewed without a score is the same "participation,
  // unknown points" claim — it is not a real score and not a poll answer.
  const hasUnscoredLeaderboard = active.some(
    (observation) =>
      observation.kind === "leaderboard" && observation.realScore == null,
  );
  if (hasLegacy || hasUnscoredLeaderboard) {
    return {
      ...base,
      class: "legacy_leaderboard",
      retainedWarnings: warnings(["legacy_leaderboard", "leaderboard"]),
    };
  }

  // 5. Poll evidence.
  const hasYes = active.some((observation) => observation.kind === "poll_yes");
  const hasNo = active.some((observation) => observation.kind === "poll_no");
  if (hasYes && hasNo) {
    return { ...base, class: "conflict", conflict: "poll_yes_no" };
  }
  if (hasYes) return { ...base, class: "yes_only" };
  if (hasNo) return { ...base, class: "explicit_no" };

  // 6. No observations survived.
  return base;
}

/**
 * Numeric value used for export/projection surfaces only — never used for
 * ranking. Real scores keep their real value (a real 1,000 or 2,000 stays
 * real); confirmed legacy projects 2,000; Yes 1,000; No 1; nothing else has
 * an outbound value.
 */
export function eventProjectionValue(
  resolved: Pick<ResolvedEventMember, "class" | "score">,
): string | null {
  switch (resolved.class) {
    case "real":
      return resolved.score;
    case "legacy_leaderboard":
      return EVENT_LEGACY_LEADERBOARD_CREDIT;
    case "yes_only":
      return EVENT_POLL_YES_CREDIT;
    case "explicit_no":
      return EVENT_POLL_NO_CREDIT;
    case "conflict":
    case "none":
      return null;
  }
}
