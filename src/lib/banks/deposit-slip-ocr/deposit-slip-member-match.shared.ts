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
