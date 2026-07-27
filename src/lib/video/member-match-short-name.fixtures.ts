import type { AshedMember } from "@/lib/video/member-matcher";

/**
 * Concrete short-name ↔ roster pairs from conductor history import.
 * Shared so import (`matchAllNames`), video hydrate (`parsedRowsToRosterReviewRows`),
 * and AppSelect fuzzy search stay aligned.
 */
export const SHORT_NAME_MEMBER_MATCH_CASES = [
  { query: "Happy", rosterName: "Happytokill", memberId: "happy" },
  { query: "orbs", rosterName: "orbsorbsorbs", memberId: "orbs" },
  { query: "SlowRider", rosterName: "Slow", memberId: "slow" },
  { query: "EG", rosterName: "EG Sie", memberId: "eg" },
  { query: "Truth", rosterName: "Truthnoisulli", memberId: "truth" },
  { query: "Podz", rosterName: "PoDzilla", memberId: "podz" },
  { query: "elsa", rosterName: "elsa 엘사", memberId: "elsa" },
  { query: "Fighter", rosterName: "Fighter55555", memberId: "fighter" },
  { query: "Aline", rosterName: "Aline the slayer", memberId: "aline" },
] as const;

export type ShortNameMemberMatchCase =
  (typeof SHORT_NAME_MEMBER_MATCH_CASES)[number];

/** Roster used with {@link SHORT_NAME_MEMBER_MATCH_CASES} (plus an unrelated member). */
export function buildShortNameMatchRoster(): AshedMember[] {
  return [
    ...SHORT_NAME_MEMBER_MATCH_CASES.map((row) => ({
      id: row.memberId,
      current_name: row.rosterName,
      status: "active" as const,
    })),
    { id: "other", current_name: "Redd", status: "active" },
  ];
}
