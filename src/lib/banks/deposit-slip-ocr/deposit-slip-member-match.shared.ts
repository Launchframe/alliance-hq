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
