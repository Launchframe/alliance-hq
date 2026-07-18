/**
 * Manual picks from depleting pools (R3 recognition, economy lottery, etc.)
 * must consume an unselected slot in the current generation — otherwise
 * officers can re-award the same member every day while the wheel correctly
 * skips them.
 */
export type DepletingManualPickResult =
  | { ok: true }
  | { ok: false; reason: "not_in_pool" | "already_awarded" };

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
