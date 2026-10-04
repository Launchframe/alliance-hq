import "server-only";

import { createHash } from "node:crypto";

/**
 * SHA-256 of the deterministic `fingerprintInput` produced by
 * `buildEventEligibility`. The draw mutation recomputes the eligibility under
 * the write lock and compares fingerprints — a changed event, readiness,
 * roster or availability 409s instead of spinning a stale board.
 */
export function eventEligibilityFingerprint(
  fingerprintInput: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(stableStringify(fingerprintInput))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
