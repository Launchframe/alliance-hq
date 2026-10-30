export const ROSTER_ASHED_SYNC_STATUSES = ["idle", "running", "failed"] as const;

export type RosterAshedSyncStatus = (typeof ROSTER_ASHED_SYNC_STATUSES)[number];

/** Reclaim a stuck `running` row after this age (serverless / crashed worker). */
export const ROSTER_ASHED_SYNC_STALE_RUNNING_MS = 10 * 60 * 1000;

export const ROSTER_ASHED_SYNC_IN_PROGRESS_CODE = "roster_sync_in_progress";

export type AshedRosterSyncStatePayload = {
  status: RosterAshedSyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  lastErrorCode: string | null;
};

export const IDLE_ASHED_ROSTER_SYNC_STATE: AshedRosterSyncStatePayload = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  lastErrorCode: null,
};

export function isRosterAshedSyncRunningStale(
  startedAt: Date | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!startedAt) {
    return true;
  }
  return nowMs - startedAt.getTime() > ROSTER_ASHED_SYNC_STALE_RUNNING_MS;
}

export function serializeAshedRosterSyncState(input: {
  status: string | null | undefined;
  startedAt: Date | null | undefined;
  finishedAt: Date | null | undefined;
  lastErrorCode: string | null | undefined;
}): AshedRosterSyncStatePayload {
  const status = ROSTER_ASHED_SYNC_STATUSES.includes(
    input.status as RosterAshedSyncStatus,
  )
    ? (input.status as RosterAshedSyncStatus)
    : "idle";

  return {
    status,
    startedAt: input.startedAt?.toISOString() ?? null,
    finishedAt: input.finishedAt?.toISOString() ?? null,
    lastErrorCode: input.lastErrorCode ?? null,
  };
}
