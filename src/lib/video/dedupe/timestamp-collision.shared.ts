/**
 * Timestamp collision helpers for OCR history lists.
 * Sub-minute second differences are treated as the same wall-clock minute (OCR noise).
 */

/** Returns `YYYY-MM-DDTHH:MM` UTC minute key, or null if unparseable. */
export function toMinuteTimestampKey(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 16);
}

/**
 * Group rows by to-the-minute timestamp. Rows without a parseable timestamp
 * are omitted from the map (caller should keep them as singletons).
 */
export function groupByMinuteTimestamp<T>(
  rows: readonly T[],
  getTs: (row: T) => string | null | undefined,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = toMinuteTimestampKey(getTs(row));
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return groups;
}

/**
 * True when two or more rows share a to-the-minute timestamp but are considered
 * distinct entities (caller supplies the entity key, e.g. normalized commander name).
 */
export function hasTimestampCollision<T>(
  rows: readonly T[],
  getTs: (row: T) => string | null | undefined,
  getEntityKey: (row: T) => string,
): boolean {
  const byMinute = groupByMinuteTimestamp(rows, getTs);
  for (const group of byMinute.values()) {
    if (group.length < 2) continue;
    const entities = new Set(group.map(getEntityKey));
    if (entities.size > 1) return true;
  }
  return false;
}
