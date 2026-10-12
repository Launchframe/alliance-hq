/**
 * Event → Ashed sync leases fence concurrent runners so a create-only POST
 * cannot be duplicated after a peer steals an expired or cleared lease.
 */

/** True when a sync-item lease is still held (unexpired). */
export function isEventSyncLeaseLive(
  leaseExpiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  return leaseExpiresAt != null && leaseExpiresAt.getTime() > now.getTime();
}

/**
 * Board-level status flags must not interrupt an in-flight POST. Only rows
 * without a live lease may be bulk-patched (and have their lease cleared).
 */
export function flagBoardItemsMayTouchLease(input: {
  leaseExpiresAt: Date | null | undefined;
  now?: Date;
}): boolean {
  return !isEventSyncLeaseLive(input.leaseExpiresAt, input.now);
}
