/**
 * Generic "is this parsed timestamp actually plausible" filter for OCR history
 * lists. Domain-agnostic — deposit slips today, but equally useful for any
 * other OCR target that extracts a timestamp (event logs, train cargo, ...).
 *
 * OCR digit errors on a date/time occasionally produce a string that still
 * parses as a *valid* timestamp (so a plain `Date.parse` check passes) but is
 * wildly implausible relative to the rest of the batch — e.g. a misread year
 * digit turning "2026" into "0256". Left alone, that row silently anchors its
 * own per-minute bucket far away from the rest of its (otherwise identical)
 * duplicates, which then never get compared against each other.
 *
 * This reclassifies such outliers as "no usable timestamp" so they flow
 * through the same missing-anchor reconciliation pass as rows that never had
 * a timestamp at all, giving them a real chance to fold back into their
 * actual duplicate.
 */

export type TimestampPlausibilityOptions = {
  /**
   * Rows whose parsed timestamp deviates from the batch median by more than
   * this many milliseconds are treated as implausible. Default 30 days —
   * generous enough for multi-day capture batches, while still catching the
   * decades/centuries-scale drift a garbled digit produces.
   */
  maxDeviationMs?: number;
  /**
   * With very few parsed timestamps, the median itself can be dragged far
   * away by a single bad outlier (e.g. 2 rows: one fine, one off by
   * centuries — the median sits between them, and *both* look "far from the
   * median"). Skip outlier detection entirely below this many timestamps.
   */
  minSampleSize?: number;
};

const DEFAULT_MAX_DEVIATION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_SAMPLE_SIZE = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Splits `rows` into those whose timestamp is plausible (close to the batch's
 * median timestamp) and those whose timestamp is a parseable but wildly
 * implausible outlier. Rows with no parseable timestamp at all are left out
 * of both buckets — callers already have a separate path for those.
 */
export function partitionPlausibleTimestamps<T>(
  rows: readonly T[],
  getTs: (row: T) => string | null | undefined,
  options?: TimestampPlausibilityOptions,
): { plausible: T[]; implausible: T[] } {
  const maxDeviationMs = options?.maxDeviationMs ?? DEFAULT_MAX_DEVIATION_MS;
  const minSampleSize = options?.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;

  const parsedMs: number[] = [];
  for (const row of rows) {
    const ts = getTs(row);
    if (!ts) continue;
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms)) parsedMs.push(ms);
  }

  if (parsedMs.length < minSampleSize) {
    return { plausible: [...rows], implausible: [] };
  }

  const medianMs = median(parsedMs);
  const plausible: T[] = [];
  const implausible: T[] = [];
  for (const row of rows) {
    const ts = getTs(row);
    const ms = ts ? Date.parse(ts) : NaN;
    if (Number.isNaN(ms)) {
      plausible.push(row);
      continue;
    }
    if (Math.abs(ms - medianMs) > maxDeviationMs) {
      implausible.push(row);
    } else {
      plausible.push(row);
    }
  }
  return { plausible, implausible };
}
