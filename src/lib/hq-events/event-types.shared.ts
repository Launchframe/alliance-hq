/**
 * Event families, evidence kinds, and scoring policy for the reviewed
 * event-results pipeline (plan: "Event participation evidence → train
 * eligibility"). Pure contract module — no I/O, safe for client bundles.
 *
 * Scores are canonical decimal strings; all comparison happens via BigInt.
 * A JS `number` can silently round beyond `Number.MAX_SAFE_INTEGER`, which
 * real event scores exceed.
 */

export const EVENT_TARGETS = [
  "warzone-duel",
  "frontline-breakthrough",
  "seasonal",
  "desert-storm",
  "canyon-storm",
] as const;

export type EventTarget = (typeof EVENT_TARGETS)[number];

/** Storm teams; `both` is a query scope, never a stored board. */
export const EVENT_TEAM_SCOPES = ["A", "B", "both"] as const;

export type EventTeamScope = (typeof EVENT_TEAM_SCOPES)[number];

/**
 * What one observation claims about a member on a board.
 *
 * `leaderboard` — a real leaderboard row; may carry an actual score.
 * `poll_yes` / `poll_no` — poll participation answers (no real score).
 * `legacy_leaderboard` — an explicitly officer-confirmed legacy marker
 * (the Ashed 2,000 convention) asserting participation with unknown points.
 */
export const EVENT_EVIDENCE_KINDS = [
  "leaderboard",
  "poll_yes",
  "poll_no",
  "legacy_leaderboard",
] as const;

export type EventEvidenceKind = (typeof EVENT_EVIDENCE_KINDS)[number];

/** Where an observation came from. */
export const EVENT_PROVENANCE_KINDS = [
  "video",
  "image",
  "manual",
  "ashed",
  "legacy",
] as const;

export type EventProvenanceKind = (typeof EVENT_PROVENANCE_KINDS)[number];

/**
 * Poll / legacy participation credits. **Projection-only values** for export
 * and sync surfaces — they are not leaderboard scores and must never enter
 * numeric Top X ranking or tie expansion. Canonical decimal strings.
 */
export const EVENT_POLL_YES_CREDIT = "1000";
export const EVENT_POLL_NO_CREDIT = "1";
export const EVENT_LEGACY_LEADERBOARD_CREDIT = "2000";

/**
 * Version stamped onto occurrences when evidence is committed, so a later
 * series-level preference cannot reinterpret historical evidence.
 */
export const EVENT_POLICY_VERSION = 1;

export type EventFamilyPolicy = {
  /** Case-insensitive search aliases for the series picker. */
  searchAliases: readonly string[];
  /**
   * Exclusive lower bound for a qualifying real score, as a canonical
   * decimal string. Warzone requires > 1; every other numeric board > 0.
   */
  realScoreMinimumExclusive: string;
  /** Frontline only: a parsed stage is required and orders before score. */
  requiresStage: boolean;
  /** Desert/Canyon Storm select a team scope. */
  teamScoped: boolean;
  /** Warzone carries poll Yes/No evidence in addition to leaderboard rows. */
  pollEvidence: boolean;
};

export const EVENT_FAMILY_POLICY: Record<EventTarget, EventFamilyPolicy> = {
  "warzone-duel": {
    searchAliases: ["warzone duel", "capitol war", "capital war", "svs"],
    realScoreMinimumExclusive: "1",
    requiresStage: false,
    teamScoped: false,
    pollEvidence: true,
  },
  "frontline-breakthrough": {
    searchAliases: ["frontline breakthrough"],
    realScoreMinimumExclusive: "0",
    requiresStage: true,
    teamScoped: false,
    pollEvidence: false,
  },
  seasonal: {
    searchAliases: ["seasonal"],
    realScoreMinimumExclusive: "0",
    requiresStage: false,
    teamScoped: false,
    pollEvidence: false,
  },
  "desert-storm": {
    searchAliases: ["desert storm"],
    realScoreMinimumExclusive: "0",
    requiresStage: false,
    teamScoped: true,
    pollEvidence: false,
  },
  "canyon-storm": {
    searchAliases: ["canyon storm"],
    realScoreMinimumExclusive: "0",
    requiresStage: false,
    teamScoped: true,
    pollEvidence: false,
  },
};

/** A real score tuple as reviewed on one board. */
export type EventScoreTuple = {
  /** Canonical decimal string. */
  score: string;
  stage: number | null;
};

/**
 * Whether a real score qualifies under the family's visible threshold.
 * Frontline additionally requires a parsed stage.
 */
export function eventRealScoreQualifies(
  target: EventTarget,
  tuple: EventScoreTuple,
): boolean {
  const policy = EVENT_FAMILY_POLICY[target];
  if (policy.requiresStage && tuple.stage == null) return false;
  return BigInt(tuple.score) > BigInt(policy.realScoreMinimumExclusive);
}

/**
 * Canonical ranking comparator (descending). Frontline compares stage first,
 * then score; all other families compare score only. Returns negative when
 * `a` ranks ahead of `b`.
 */
export function compareEventResults(
  target: EventTarget,
  a: EventScoreTuple,
  b: EventScoreTuple,
): number {
  const policy = EVENT_FAMILY_POLICY[target];
  if (policy.requiresStage) {
    const stageDiff = (b.stage ?? 0) - (a.stage ?? 0);
    if (stageDiff !== 0) return stageDiff;
  }
  const left = BigInt(a.score);
  const right = BigInt(b.score);
  return left === right ? 0 : left > right ? -1 : 1;
}
