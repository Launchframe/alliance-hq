/** Auto-refresh Ashed roster when local cache is older than this. */
export const ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isRosterAshedSyncStale(
  lastSyncedAt: Date | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!lastSyncedAt) {
    return true;
  }
  return nowMs - lastSyncedAt.getTime() > ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS;
}

export function shouldSyncRosterFromAshed(input: {
  forceRefresh: boolean;
  lastSyncedAt: Date | null | undefined;
  localMemberCount: number;
  nowMs?: number;
}): boolean {
  if (input.forceRefresh) {
    return true;
  }
  if (input.localMemberCount === 0) {
    return true;
  }
  return isRosterAshedSyncStale(input.lastSyncedAt, input.nowMs);
}
