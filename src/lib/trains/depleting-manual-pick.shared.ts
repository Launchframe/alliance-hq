/**
 * Manual picks from depleting pools (R3 recognition, economy lottery, etc.)
 * consume an unselected slot when the member is still eligible. Officers may
 * confirm an override to assign any **active** member — the wheel stays hard.
 */
export const MANUAL_PICK_ELIGIBILITY_OVERRIDE_CODE =
  "eligibility_override_required" as const;

export type ManualPickEligibilityReason =
  | "not_in_pool"
  | "already_awarded"
  | "rank_ineligible";

export type DepletingManualPickResult =
  | { ok: true }
  | { ok: false; reason: "not_in_pool" | "already_awarded" };

export class ManualPickEligibilityError extends Error {
  readonly code: typeof MANUAL_PICK_ELIGIBILITY_OVERRIDE_CODE =
    MANUAL_PICK_ELIGIBILITY_OVERRIDE_CODE;
  readonly reason: ManualPickEligibilityReason;

  constructor(reason: ManualPickEligibilityReason, message: string) {
    super(message);
    this.name = "ManualPickEligibilityError";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isManualPickEligibilityError(
  error: unknown,
): error is ManualPickEligibilityError {
  if (error instanceof ManualPickEligibilityError) return true;
  if (!(error instanceof Error) || error.name !== "ManualPickEligibilityError") {
    return false;
  }
  return (
    "reason" in error &&
    (error.reason === "not_in_pool" ||
      error.reason === "already_awarded" ||
      error.reason === "rank_ineligible")
  );
}

export function officerConfirmedManualPickOverride(input: {
  allowEligibilityOverride?: boolean;
  /** @deprecated alias kept for the same-generation confirm payload */
  allowSameGenerationReuse?: boolean;
}): boolean {
  return (
    input.allowEligibilityOverride === true ||
    input.allowSameGenerationReuse === true
  );
}

export function rankIneligibleManualPickMessage(
  poolType: "r3" | "r4_plus",
): string {
  return poolType === "r3"
    ? "R3 pool manual picks must select an R3 member."
    : "R4+ pool manual picks must select an R4 or R5 member.";
}

export function evaluateDepletingManualPick(input: {
  memberId: string;
  unselectedMemberIds: readonly string[];
  poolMemberIds: readonly string[];
}): DepletingManualPickResult {
  if (input.unselectedMemberIds.includes(input.memberId)) {
    return { ok: true };
  }
  if (input.poolMemberIds.includes(input.memberId)) {
    return { ok: false, reason: "already_awarded" };
  }
  return { ok: false, reason: "not_in_pool" };
}

export function depletingManualPickErrorMessage(
  reason: "not_in_pool" | "already_awarded",
): string {
  if (reason === "already_awarded") {
    return "This member was already selected from the current pool generation.";
  }
  return "This member is not in the current conductor pool.";
}

/**
 * When replacing a depleting-pool conductor/VIP, release the prior member only
 * after the replacement is successfully claimed. Releasing first lets a failed
 * re-roll / manual pick leave the draft assignment in place while the prior
 * member is free to win another day in the same generation.
 */
export function shouldReleasePriorPoolSelection(input: {
  previousMemberId: string | null | undefined;
  nextMemberId: string;
}): boolean {
  const previous = input.previousMemberId?.trim();
  const next = input.nextMemberId.trim();
  return Boolean(previous && next && previous !== next);
}
