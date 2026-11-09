import "server-only";

import { and, eq, lt, ne, or, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  IDLE_ASHED_ROSTER_SYNC_STATE,
  isRosterAshedSyncRunningStale,
  ROSTER_ASHED_SYNC_IN_PROGRESS_CODE,
  ROSTER_ASHED_SYNC_STALE_RUNNING_MS,
  rosterAshedSyncGenerationStillOwns,
  serializeAshedRosterSyncState,
  type AshedRosterSyncStatePayload,
} from "@/lib/members/roster-ashed-sync-status.shared";

export class RosterAshedSyncInProgressError extends Error {
  readonly code = ROSTER_ASHED_SYNC_IN_PROGRESS_CODE;
  readonly status = 409;

  constructor(message = "Roster sync is in progress. Try again when it finishes.") {
    super(message);
    this.name = "RosterAshedSyncInProgressError";
  }
}

export async function getAllianceRosterAshedSyncState(
  allianceId: string,
): Promise<AshedRosterSyncStatePayload> {
  const db = getDb();
  const [row] = await db
    .select({
      status: schema.alliances.rosterAshedSyncStatus,
      startedAt: schema.alliances.rosterAshedSyncStartedAt,
      finishedAt: schema.alliances.rosterAshedSyncFinishedAt,
      lastErrorCode: schema.alliances.rosterAshedSyncLastErrorCode,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!row) {
    return IDLE_ASHED_ROSTER_SYNC_STATE;
  }

  return serializeAshedRosterSyncState(row);
}

export type RosterAshedSyncClaim = {
  /** Generation fence. Completion updates must match this timestamp. */
  startedAt: Date;
};

/**
 * CAS idle|failed (or stale running) → running.
 * Returns the generation when this caller claimed the sync slot.
 */
export async function tryBeginAllianceRosterAshedSync(
  allianceId: string,
  now = new Date(),
): Promise<RosterAshedSyncClaim | null> {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - ROSTER_ASHED_SYNC_STALE_RUNNING_MS);

  const updated = await db
    .update(schema.alliances)
    .set({
      rosterAshedSyncStatus: "running",
      rosterAshedSyncStartedAt: now,
      rosterAshedSyncFinishedAt: null,
      rosterAshedSyncLastErrorCode: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.alliances.id, allianceId),
        or(
          ne(schema.alliances.rosterAshedSyncStatus, "running"),
          lt(schema.alliances.rosterAshedSyncStartedAt, staleBefore),
          sql`${schema.alliances.rosterAshedSyncStartedAt} is null`,
        ),
      ),
    )
    .returning({
      startedAt: schema.alliances.rosterAshedSyncStartedAt,
    });

  const startedAt = updated[0]?.startedAt;
  if (!startedAt) return null;
  return { startedAt };
}

export async function allianceRosterAshedSyncOwnedBy(
  allianceId: string,
  generationStartedAt: Date,
): Promise<boolean> {
  const state = await getAllianceRosterAshedSyncState(allianceId);
  return rosterAshedSyncGenerationStillOwns({
    status: state.status,
    startedAt: state.startedAt ? new Date(state.startedAt) : null,
    generationStartedAt,
  });
}

function generationFence(allianceId: string, generationStartedAt: Date) {
  return and(
    eq(schema.alliances.id, allianceId),
    eq(schema.alliances.rosterAshedSyncStatus, "running"),
    eq(schema.alliances.rosterAshedSyncStartedAt, generationStartedAt),
  );
}

/** Idle only if this generation still owns `running`. */
export async function markAllianceRosterAshedSyncIdle(
  allianceId: string,
  generationStartedAt: Date,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.alliances)
    .set({
      rosterAshedSyncStatus: "idle",
      rosterAshedSyncFinishedAt: now,
      rosterAshedSyncLastErrorCode: null,
      updatedAt: now,
    })
    .where(generationFence(allianceId, generationStartedAt))
    .returning({ id: schema.alliances.id });
  return updated.length > 0;
}

/** Failed only if this generation still owns `running`. */
export async function markAllianceRosterAshedSyncFailed(
  allianceId: string,
  generationStartedAt: Date,
  lastErrorCode: string,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.alliances)
    .set({
      rosterAshedSyncStatus: "failed",
      rosterAshedSyncFinishedAt: now,
      rosterAshedSyncLastErrorCode: lastErrorCode,
      updatedAt: now,
    })
    .where(generationFence(allianceId, generationStartedAt))
    .returning({ id: schema.alliances.id });
  return updated.length > 0;
}

/**
 * Read-only guard. Mutations must call this inside
 * `withAllianceRosterMutationLock` so a sync cannot claim `running`
 * between the check and the write.
 */
export async function assertAllianceRosterAshedSyncIdle(
  allianceId: string,
): Promise<void> {
  const state = await getAllianceRosterAshedSyncState(allianceId);
  if (state.status !== "running") {
    return;
  }
  const startedAt = state.startedAt ? new Date(state.startedAt) : null;
  if (isRosterAshedSyncRunningStale(startedAt)) {
    return;
  }
  throw new RosterAshedSyncInProgressError();
}

/** Poll until the live lease ends or `timeoutMs` elapses. Does not take the sync lock. */
export async function waitForAllianceRosterAshedSyncIdle(
  allianceId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await getAllianceRosterAshedSyncState(allianceId);
    if (state.status !== "running") return;
    const startedAt = state.startedAt ? new Date(state.startedAt) : null;
    if (isRosterAshedSyncRunningStale(startedAt)) return;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
