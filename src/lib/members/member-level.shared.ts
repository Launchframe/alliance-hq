/** In-game HQ / base level for Last War commanders (capped at 35). */

export const MIN_MEMBER_HQ_LEVEL = 1;
export const MAX_MEMBER_HQ_LEVEL = 35;

/** Clamp a finite integer into the valid HQ level range. */
export function clampMemberHqLevel(value: number): number {
  return Math.min(
    MAX_MEMBER_HQ_LEVEL,
    Math.max(MIN_MEMBER_HQ_LEVEL, Math.round(value)),
  );
}

/**
 * Normalize an unknown OCR / API / form value to a valid HQ level, or null.
 * Values above the in-game cap are clamped (not rejected) so dual-write can
 * correct Ashed with a sane HQ total.
 */
export function normalizeMemberHqLevel(value: unknown): number | null {
  let level: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    level = Math.round(value);
  } else if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) level = Math.round(parsed);
  }
  if (level == null || level < MIN_MEMBER_HQ_LEVEL) return null;
  return clampMemberHqLevel(level);
}

export function isValidMemberHqLevel(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_MEMBER_HQ_LEVEL &&
    value <= MAX_MEMBER_HQ_LEVEL
  );
}
