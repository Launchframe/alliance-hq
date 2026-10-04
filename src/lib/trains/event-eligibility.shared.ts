import {
  compareEventResults,
  eventRealScoreQualifies,
  EVENT_FAMILY_POLICY,
  type EventTarget,
  type EventTeamScope,
} from "@/lib/hq-events/event-types.shared";
import type { ResolvedEventMember } from "@/lib/hq-events/evidence-merge.shared";

/**
 * Pure event eligibility (plan §5 "Eligibility calculation", steps 2–9).
 * One implementation shared by the preview service and the draw mutation —
 * callers pass canonical resolved members (already merged per board) plus
 * roster, exclusions and ready state; the result is deterministic and the
 * `fingerprintInput` is hashed server-side into the draw fence.
 *
 * Scores stay canonical decimal strings; ordering is BigInt-safe.
 */

export type EventEligibilityRole = "conductor" | "vip";
export type EventEligibilityKind = "scored" | "participants";
export type EventEligibilityTopN = 1 | 3 | 5 | 10 | "all";
export type EventEligibilityFallback = "none" | "confirmed_poll_yes";

/** Canonical identity of the occurrence/board scope a rule is bound to. */
export type EventEligibilitySourceIdentity = {
  target: EventTarget;
  seriesId: string | null;
  occurrenceId: string | null;
  /** Every board whose results feed this rule; order normalized on read. */
  boardKeys: readonly string[];
  teamScope: EventTeamScope | null;
};

export type EventEligibilityInput = {
  /** Canonical source identity — binds the fingerprint to the occurrence. */
  sourceIdentity: EventEligibilitySourceIdentity;
  role: EventEligibilityRole;
  eligibility: EventEligibilityKind;
  topN: EventEligibilityTopN;
  fallback: EventEligibilityFallback;
  /** Resolved members on the primary board (or sole board). */
  results: readonly ResolvedEventMember[];
  /** Storm `both` only: resolved members on the second team board. */
  secondaryResults?: readonly ResolvedEventMember[];
  /** Current active roster member ids — results outside are not candidates. */
  activeMemberIds: readonly string[];
  /** Role/day exclusions (time off, same-day re-spin exclusions, …). */
  exclusions?: readonly { memberId: string; reason: string }[];
  /** VIP draws exclude the day's locked conductor. */
  lockedConductorId?: string | null;
  /** Rule is bound to a concrete occurrence/board/team. */
  bound: boolean;
  /** Results reflect the board's current ready revision(s). */
  readyRevisionsBound: boolean;
  /** Board id → ready revision the resolved results were built from. */
  readyRevisions: readonly { boardId: string; readyVersion: number }[];
  /** Officer explicitly confirmed the scored board is empty. */
  emptyBoardConfirmed: boolean;
};

export type EventEligibilityGroups = {
  real: number;
  legacy: number;
  yesOnly: number;
  noOnly: number;
  conflict: number;
  noEvidence: number;
};

export type EventEligibility =
  | { ok: false; reason: "unbound" | "not_ready" }
  | {
      ok: true;
      /** Unique member ids, deterministic order, uniform one-ticket draw. */
      candidates: string[];
      groupCounts: EventEligibilityGroups;
      /** Reason → count, only for members that were otherwise qualifying. */
      exclusionReasons: Record<string, number>;
      cutoff: {
        applied: boolean;
        /** Score of the last included member, canonical decimal string. */
        score: string | null;
        /** Stage of the last included member (Frontline ordering). */
        stage: number | null;
        /** Extra members admitted because they tie at the cutoff. */
        tieExpanded: number;
      };
      /** Fewer qualifying real members than the numeric scope — all included. */
      shortBoard: boolean;
      /** Qualifying members under the rule before exclusions. */
      scoredBoardSize: number;
      /** Qualifying members still drawable after exclusions. */
      drawableCount: number;
      fallback: {
        available: boolean;
        requiresAcknowledgement: boolean;
        /** Yes respondents drawable after the same exclusions. */
        candidates: string[];
      };
      /** Deterministic structure hashed into the eligibility fingerprint. */
      fingerprintInput: Record<string, unknown>;
    };

const CLASS_ORDER: Record<ResolvedEventMember["class"], number> = {
  none: 0,
  explicit_no: 1,
  yes_only: 2,
  legacy_leaderboard: 3,
  real: 4,
  conflict: 5,
};

/**
 * Storm `both` combines two separately resolved team results per member:
 * each team's merge already happened, so a real score keeps its provenance
 * and members draw once with their higher resolved score — never a sum.
 */
function combineTeamResults(
  memberId: string,
  a: ResolvedEventMember | undefined,
  b: ResolvedEventMember | undefined,
): ResolvedEventMember {
  const first = a ?? b;
  const combined: ResolvedEventMember = {
    memberId,
    class: first?.class ?? "none",
    score: null,
    stage: null,
    observedRank: null,
    conflict: null,
    retainedWarnings: [
      ...(a?.retainedWarnings ?? []),
      ...(b?.retainedWarnings ?? []),
    ],
    corrections: [...(a?.corrections ?? []), ...(b?.corrections ?? [])],
  };
  const classes = [a?.class, b?.class].filter(
    (value): value is ResolvedEventMember["class"] => value != null,
  );
  if (classes.length === 0) return combined;
  if (classes.includes("conflict")) {
    combined.class = "conflict";
    combined.conflict = a?.conflict ?? b?.conflict ?? "poll_yes_no";
    return combined;
  }
  const real = [a, b].filter(
    (result): result is ResolvedEventMember => result?.class === "real",
  );
  if (real.length > 0) {
    const best = real.reduce((winner, candidate) =>
      BigInt(candidate.score!) > BigInt(winner.score!) ? candidate : winner,
    );
    combined.class = "real";
    combined.score = best.score;
    combined.stage = best.stage;
    combined.observedRank = best.observedRank;
    return combined;
  }
  combined.class = classes.reduce((winner, candidate) =>
    CLASS_ORDER[candidate] > CLASS_ORDER[winner] ? candidate : winner,
  );
  return combined;
}

export function buildEventEligibility(
  input: EventEligibilityInput,
): EventEligibility {
  if (!input.bound) return { ok: false, reason: "unbound" };
  if (!input.readyRevisionsBound) return { ok: false, reason: "not_ready" };

  const active = new Set(input.activeMemberIds);
  const target = input.sourceIdentity.target;
  const teamScoped = EVENT_FAMILY_POLICY[target].teamScoped;

  // Per-member resolution across the selected board scope.
  const resolvedByMember = new Map<string, ResolvedEventMember>();
  if (teamScoped && input.sourceIdentity.teamScope === "both") {
    const primary = new Map(input.results.map((row) => [row.memberId, row]));
    const secondary = new Map(
      (input.secondaryResults ?? []).map((row) => [row.memberId, row]),
    );
    for (const memberId of new Set([...primary.keys(), ...secondary.keys()])) {
      resolvedByMember.set(
        memberId,
        combineTeamResults(
          memberId,
          primary.get(memberId),
          secondary.get(memberId),
        ),
      );
    }
  } else {
    for (const row of input.results) resolvedByMember.set(row.memberId, row);
  }

  // Groups are counted over the active roster — a member with no surviving
  // evidence is "no evidence", never an implied No.
  const groupMembers: Record<keyof EventEligibilityGroups, string[]> = {
    real: [],
    legacy: [],
    yesOnly: [],
    noOnly: [],
    conflict: [],
    noEvidence: [],
  };
  const resolvedActive = new Map<string, ResolvedEventMember>();
  for (const memberId of active) {
    const resolved = resolvedByMember.get(memberId);
    const effective = resolved && resolved.class !== "none" ? resolved : null;
    if (effective) resolvedActive.set(memberId, effective);
    switch (effective?.class) {
      case "real":
        groupMembers.real.push(memberId);
        break;
      case "legacy_leaderboard":
        groupMembers.legacy.push(memberId);
        break;
      case "yes_only":
        groupMembers.yesOnly.push(memberId);
        break;
      case "explicit_no":
        groupMembers.noOnly.push(memberId);
        break;
      case "conflict":
        groupMembers.conflict.push(memberId);
        break;
      default:
        groupMembers.noEvidence.push(memberId);
    }
  }
  for (const list of Object.values(groupMembers)) list.sort();

  // Qualifying real members under the family's visible score policy.
  const qualifyingReal = groupMembers.real.filter((memberId) => {
    const resolved = resolvedActive.get(memberId)!;
    return eventRealScoreQualifies(target, {
      score: resolved.score!,
      stage: resolved.stage,
    });
  });

  let qualifying: string[];
  let cutoffScore: string | null = null;
  let cutoffStage: number | null = null;
  let tieExpanded = 0;
  let cutoffApplied = false;
  let shortBoard = false;

  if (input.eligibility === "participants") {
    qualifying = [...qualifyingReal, ...groupMembers.legacy, ...groupMembers.yesOnly];
  } else if (input.topN === "all") {
    qualifying = [...qualifyingReal, ...groupMembers.legacy];
  } else {
    const sorted = [...qualifyingReal].sort((left, right) => {
      const a = resolvedActive.get(left)!;
      const b = resolvedActive.get(right)!;
      return (
        compareEventResults(
          target,
          { score: a.score!, stage: a.stage },
          { score: b.score!, stage: b.stage },
        ) || left.localeCompare(right)
      );
    });
    const limit = input.topN;
    qualifying = sorted.slice(0, limit);
    if (sorted.length > limit) {
      // Include every member tied with the last included comparator tuple.
      const last = resolvedActive.get(sorted[limit - 1]!)!;
      let index = limit;
      while (
        index < sorted.length &&
        compareEventResults(
          target,
          {
            score: last.score!,
            stage: last.stage,
          },
          {
            score: resolvedActive.get(sorted[index]!)!.score!,
            stage: resolvedActive.get(sorted[index]!)!.stage,
          },
        ) === 0
      ) {
        qualifying.push(sorted[index]!);
        index += 1;
      }
      tieExpanded = qualifying.length - limit;
    }
    cutoffApplied = sorted.length >= limit;
    const cutoffMember =
      qualifying.length > 0
        ? resolvedActive.get(qualifying[qualifying.length - 1]!)
        : undefined;
    cutoffScore = cutoffMember?.score ?? null;
    cutoffStage = cutoffMember?.stage ?? null;
    shortBoard = sorted.length < limit;
  }

  // Exclusions apply after the cutoff — an unavailable Top-10 member does not
  // silently promote #11.
  const exclusionByMember = new Map<string, string>();
  for (const entry of input.exclusions ?? []) {
    if (!exclusionByMember.has(entry.memberId)) {
      exclusionByMember.set(entry.memberId, entry.reason);
    }
  }
  if (input.role === "vip" && input.lockedConductorId) {
    exclusionByMember.set(input.lockedConductorId, "locked_conductor");
  }
  const exclusionReasons: Record<string, number> = {};
  const qualifyingSet = new Set(qualifying);
  const candidates = qualifying.filter((memberId) => {
    const reason = exclusionByMember.get(memberId);
    if (reason == null) return true;
    exclusionReasons[reason] = (exclusionReasons[reason] ?? 0) + 1;
    return false;
  });
  candidates.sort();

  const fallbackCandidates = groupMembers.yesOnly
    .filter((memberId) => !exclusionByMember.has(memberId))
    .sort();
  // The scored board is empty only when NO resolved member row — active
  // roster or not — carries a real or legacy leaderboard score. Scorers who
  // left the alliance still mean the event was not empty.
  const scoredBoardEmpty = ![...resolvedByMember.values()].some(
    (resolved) =>
      resolved.class === "real" || resolved.class === "legacy_leaderboard",
  );
  // Fallback requires a genuinely empty scored board AND an explicit
  // empty-board confirmation — exhaustion, unavailability, or an unranked
  // legacy list must never silently broaden to Yes respondents.
  const fallbackAvailable =
    scoredBoardEmpty &&
    input.emptyBoardConfirmed &&
    input.fallback === "confirmed_poll_yes";

  const fingerprintInput: Record<string, unknown> = {
    sourceIdentity: {
      target: input.sourceIdentity.target,
      seriesId: input.sourceIdentity.seriesId,
      occurrenceId: input.sourceIdentity.occurrenceId,
      boardKeys: [...input.sourceIdentity.boardKeys].sort(),
      teamScope: input.sourceIdentity.teamScope,
    },
    readyRevisions: [...input.readyRevisions]
      .map((entry) => ({
        boardId: entry.boardId,
        readyVersion: entry.readyVersion,
      }))
      .sort((a, b) => a.boardId.localeCompare(b.boardId)),
    role: input.role,
    eligibility: input.eligibility,
    topN: input.topN,
    fallback: input.fallback,
    candidates,
    groupCounts: {
      real: groupMembers.real.length,
      legacy: groupMembers.legacy.length,
      yesOnly: groupMembers.yesOnly.length,
      noOnly: groupMembers.noOnly.length,
      conflict: groupMembers.conflict.length,
      noEvidence: groupMembers.noEvidence.length,
    },
    exclusionReasons,
    cutoffScore,
    cutoffStage,
    tieExpanded,
    shortBoard,
    emptyBoardConfirmed: input.emptyBoardConfirmed,
    lockedConductorId: input.lockedConductorId ?? null,
    fallbackCandidates,
    fallbackAvailable,
  };

  return {
    ok: true,
    candidates,
    groupCounts: fingerprintInput.groupCounts as EventEligibilityGroups,
    exclusionReasons,
    cutoff: {
      applied: cutoffApplied,
      score: cutoffScore,
      stage: cutoffStage,
      tieExpanded,
    },
    shortBoard,
    scoredBoardSize: qualifyingSet.size,
    drawableCount: candidates.length,
    fallback: {
      available: fallbackAvailable,
      requiresAcknowledgement: true,
      candidates: fallbackCandidates,
    },
    fingerprintInput,
  };
}
