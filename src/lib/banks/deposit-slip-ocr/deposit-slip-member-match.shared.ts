/**
 * Deposit-slip member match thresholds — shared between the server-only
 * resolver (`resolve-deposit-slip-member.server.ts`, which pulls in `@/lib/db`
 * and cannot be imported from `"use client"` components) and the review-table
 * UI (`DepositSlipVideoReviewTable.tsx`), so the auto-link cutoff and the
 * near-miss color-coding boundary can never drift apart.
 */

import { MEMBER_FUZZY_AUTO_MATCH_MIN } from "@/lib/video/member-matcher";

/**
 * Fuzzy name matches at/above this confidence may auto-link FKs at commit.
 * Exact / previous_name always auto-link. Below this, candidate is surfaced
 * for review but member FKs stay null.
 */
export const DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN = 0.85;

/** Lowest confidence `matchMemberName` will ever surface as a candidate. */
export const DEPOSIT_SLIP_MEMBER_NEAR_MISS_MIN = MEMBER_FUZZY_AUTO_MATCH_MIN;

export type DepositSlipTagMatchMethodForConfidence =
  | "exact"
  | "fuzzy"
  | "none"
  | "ambiguous";

/**
 * Review-table confidence: when the alliance tag was only a fuzzy guess,
 * cap the displayed % at the tag similarity so exact-name + fuzzy-tag does
 * not read as a perfect green match.
 *
 * Auto-link gating still uses raw name confidence separately.
 */
export function depositSlipReviewMatchConfidence(
  nameConfidence: number,
  tagMatchMethod: DepositSlipTagMatchMethodForConfidence,
  tagMatchConfidence: number,
): number {
  if (tagMatchMethod === "fuzzy") {
    return Math.min(nameConfidence, tagMatchConfidence);
  }
  return nameConfidence;
}

/**
 * `parsed_rows.matchMethod` is `"none"` for near-miss display-only candidates.
 * Any other non-empty method means parse-time auto-link cleared the gate.
 */
export function isDepositSlipAutoLinkedMatchMethod(
  matchMethod: string | null | undefined,
): boolean {
  return (
    matchMethod != null &&
    matchMethod !== "" &&
    matchMethod !== "none"
  );
}

/**
 * Border class for deposit-slip Matched Member selects — uses the same
 * auto-link / near-miss thresholds as parse-time matching so officers are
 * not misled by the generic score-review border helper (≥0.9 solid).
 */
/** Row patch applied when an officer clears a matched member (dropdown empty or X). */
export const DEPOSIT_SLIP_CLEARED_MEMBER_MATCH = {
  memberId: null,
  memberName: null,
  matchConfidence: 0,
  matchMethod: "none",
} as const;

export function depositSlipMemberMatchBorderClass(
  confidence: number | null | undefined,
): string {
  if (confidence == null || confidence <= 0) {
    return "border-hq-border";
  }
  if (confidence >= DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN) {
    return "border-hq-green";
  }
  if (confidence >= DEPOSIT_SLIP_MEMBER_NEAR_MISS_MIN) {
    return "border-hq-warning";
  }
  return "border-hq-border";
}
