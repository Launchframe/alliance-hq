/**
 * Generic "resolve-or-flag" step for a cluster of same-entity OCR rows.
 * Domain-agnostic — the caller supplies field specs (how to read a field, and
 * optionally how to compare two values); this module decides whether every
 * disagreeing field has a clear majority (auto-correctable) or not (must flag
 * for officer review).
 */

import {
  resolveByMajority,
  type MajorityTieBreak,
} from "@/lib/video/dedupe/majority-vote.shared";

export type ConflictFieldSpec<T> = {
  /** Stable identifier for this field, surfaced in corrections / flagged reasons. */
  key: string;
  get: (item: T) => unknown;
  isEqual?: (a: unknown, b: unknown) => boolean;
  /**
   * Optional tiebreaker for a genuine local tie (no majority) — e.g. score by how
   * often this value appears elsewhere in the whole batch. Only consulted when
   * majority vote fails outright; see `resolveByMajority`'s `tieBreak` for the
   * "must clearly win" guardrail that keeps this from over-firing on soft calls.
   */
  tieBreaker?: MajorityTieBreak<unknown>;
};

export type FieldCorrection = {
  key: string;
  value: unknown;
};

export type ConflictResolution =
  | { resolved: true; corrections: FieldCorrection[] }
  | { resolved: false; conflictingFields: string[] };

function defaultIsEqual(a: unknown, b: unknown): boolean {
  return a === b;
}

function fieldHasDisagreement(
  values: readonly unknown[],
  isEqual: (a: unknown, b: unknown) => boolean,
): boolean {
  const present = values.filter((v) => v != null);
  if (present.length < 2) return false;
  const first = present[0];
  return present.some((v) => !isEqual(first, v));
}

/**
 * For every field where the group disagrees, try to resolve it by majority vote.
 * - `resolved: true` when every disagreeing field found a majority (or no field
 *   disagreed at all) — `corrections` lists the fields that need to be overwritten
 *   with the majority value (empty when the group was already unanimous).
 * - `resolved: false` when at least one disagreeing field has no clear majority
 *   (e.g. a 2-2 split) — `conflictingFields` names them so the caller can flag the
 *   cluster with a reason that reflects what's actually wrong.
 */
export function resolveGroupConflicts<T>(
  group: readonly T[],
  fields: readonly ConflictFieldSpec<T>[],
): ConflictResolution {
  const corrections: FieldCorrection[] = [];
  const conflictingFields: string[] = [];

  for (const field of fields) {
    const isEqual = field.isEqual ?? defaultIsEqual;
    const values = group.map((item) => field.get(item));
    if (!fieldHasDisagreement(values, isEqual)) continue;

    const majority = resolveByMajority(
      values,
      isEqual,
      field.tieBreaker,
    );
    if (majority) {
      corrections.push({ key: field.key, value: majority.value });
    } else {
      conflictingFields.push(field.key);
    }
  }

  if (conflictingFields.length > 0) {
    return { resolved: false, conflictingFields };
  }
  return { resolved: true, corrections };
}
