/**
 * Event → Ashed create-only POSTs must not outlive the sync-item lease.
 * An unbounded fetch lets a peer reclaim after LEASE_MS and POST again while
 * the original request is still in flight → duplicate remote scores and a
 * sticky `duplicate_remote` conflict (create-only sync never deletes).
 */

/** Claim window for one sync-item POST attempt. */
export const EVENT_SYNC_LEASE_MS = 60_000;

/**
 * Client abort bound for the outbound create POST. Must stay strictly below
 * {@link EVENT_SYNC_LEASE_MS} so the holder can mark `uncertain` and keep the
 * lease until expiry while a late server write may still become visible.
 */
export const EVENT_SYNC_POST_TIMEOUT_MS = 15_000;

/** True when a timed-out / 5xx / lost-reply POST should keep the lease fence. */
export function shouldRetainEventSyncLeaseAfterUncertainPost(input: {
  /** HTTP status when known; null/undefined for abort, timeout, or network. */
  statusCode?: number | null;
}): boolean {
  const code = input.statusCode;
  return code == null || code >= 500;
}

/**
 * Lease / retry patch after a create POST becomes uncertain.
 * Retaining the live lease blocks peer reclaim until the original window ends.
 */
export function eventSyncUncertainLeasePatch(input: {
  leaseExpiresAt: Date;
  now?: Date;
  retainLease: boolean;
}): { clearLease: boolean; retryAt: Date } {
  const now = input.now ?? new Date();
  if (input.retainLease && input.leaseExpiresAt.getTime() > now.getTime()) {
    return { clearLease: false, retryAt: input.leaseExpiresAt };
  }
  return { clearLease: true, retryAt: new Date(now.getTime() + 60_000) };
}
