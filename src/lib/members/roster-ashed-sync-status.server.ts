import "server-only";

import { and, eq, lt, ne, or, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  IDLE_ASHED_ROSTER_SYNC_STATE,
  isRosterAshedSyncRunningStale,
  ROSTER_ASHED_SYNC_IN_PROGRESS_CODE,
  ROSTER_ASHED_SYNC_STALE_RUNNING_MS,
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

/**
 * CAS idle|failed (or stale running) → running.
 * Returns true when this caller claimed the sync slot.
 */
export async function tryBeginAllianceRosterAshedSync(
  allianceId: string,
  now = new Date(),
): Promise<boolean> {
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
    .returning({ id: schema.alliances.id });

  return updated.length > 0;
}

export async function markAllianceRosterAshedSyncIdle(
  allianceId: string,
  now = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      rosterAshedSyncStatus: "idle",
      rosterAshedSyncFinishedAt: now,
      rosterAshedSyncLastErrorCode: null,
      updatedAt: now,
    })
    .where(eq(schema.alliances.id, allianceId));
}

export async function markAllianceRosterAshedSyncFailed(
  allianceId: string,
  lastErrorCode: string,
  now = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      rosterAshedSyncStatus: "failed",
      rosterAshedSyncFinishedAt: now,
      rosterAshedSyncLastErrorCode: lastErrorCode,
      updatedAt: now,
    })
    .where(eq(schema.alliances.id, allianceId));
}

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
