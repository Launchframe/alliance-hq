import "server-only";

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { ActivityWriteError } from "@/lib/activity/errors.server";
import {
  captureActivityContext,
  type ActivityIdentity,
} from "@/lib/activity/identity.server";
import {
  appendActivityEvent,
  withActivityTransaction,
  type ActivityTransaction,
} from "@/lib/activity/writer.server";
import { getDb, schema } from "@/lib/db";
import type { KillsEventSource } from "@/lib/kills/constants";
import { parseStoredKillsPending } from "@/lib/kills/pending-state";
import type { KillsPendingState } from "@/lib/kills/types";

export { getCommanderIdForMember } from "@/lib/thp/repository";
export { getCommanderMembershipInAlliance } from "@/lib/thp/repository";

const PENDING_TTL_MS = 30 * 60 * 1000;

export type KillsSubmissionActivity = {
  identity: Exclude<ActivityIdentity, { kind: "automation" }>;
  method: "manual" | "screenshot";
  pending?: { expected: KillsPendingState; required: boolean };
};

export class KillsPendingChangedError extends Error {
  constructor() {
    super("kills_pending_changed");
    this.name = "KillsPendingChangedError";
  }
}

const HQ_SOURCES_PENDING_ASHED_SYNC = new Set<KillsEventSource>([
  "web",
  "discord",
  "video_parse",
  "screenshot_ocr",
]);

function ashedSyncedAtForSource(
  source: KillsEventSource,
  now: Date,
  markAshedSynced?: boolean,
): Date | null {
  if (markAshedSynced) {
    return now;
  }
  if (source === "ashed_sync" || source === "officer_override") {
    return now;
  }
  if (HQ_SOURCES_PENDING_ASHED_SYNC.has(source)) {
    return null;
  }
  return null;
}

export async function getCommanderKillsState(commanderId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      currentKills: schema.commanders.currentKills,
      killsUpdatedAt: schema.commanders.killsUpdatedAt,
      primaryName: schema.commanders.primaryName,
    })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, commanderId))
    .limit(1);
  return row ?? null;
}

export async function listAllianceCommanderKillsRows(allianceId: string) {
  const db = getDb();
  return db
    .select({
      commanderId: schema.commanders.id,
      total: schema.commanders.currentKills,
    })
    .from(schema.commanders)
    .where(
      and(
        eq(schema.commanders.currentAllianceId, allianceId),
        isNotNull(schema.commanders.currentKills),
      ),
    );
}

export async function listCommanderKillsEvents(commanderId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.commanderKillsEvents)
    .where(eq(schema.commanderKillsEvents.commanderId, commanderId))
    .orderBy(asc(schema.commanderKillsEvents.createdAt));
}

export async function listAllianceCommanderKillsEvents(allianceId: string) {
  const db = getDb();
  const commanders = await listAllianceCommanderKillsRows(allianceId);
  if (commanders.length === 0) {
    return new Map<
      string,
      Array<{ commanderId: string; total: number; createdAt: Date }>
    >();
  }
  const commanderIds = commanders.map((row) => row.commanderId);
  const events = await db
    .select({
      commanderId: schema.commanderKillsEvents.commanderId,
      total: schema.commanderKillsEvents.total,
      createdAt: schema.commanderKillsEvents.createdAt,
    })
    .from(schema.commanderKillsEvents)
    .where(inArray(schema.commanderKillsEvents.commanderId, commanderIds))
    .orderBy(asc(schema.commanderKillsEvents.createdAt));

  const byCommander = new Map<
    string,
    Array<{ commanderId: string; total: number; createdAt: Date }>
  >();
  for (const event of events) {
    const list = byCommander.get(event.commanderId) ?? [];
    list.push(event);
    byCommander.set(event.commanderId, list);
  }
  return byCommander;
}

export async function upsertCommanderKills(input: {
  commanderId: string;
  total: number;
  allianceId?: string | null;
  ashedMemberId?: string | null;
  memberName?: string | null;
  source: KillsEventSource;
  hqUserId?: string | null;
  discordUserId?: string | null;
  /** When true, skip outbound Member.current_kills sync (already written elsewhere). */
  markAshedSynced?: boolean;
  activity?: KillsSubmissionActivity;
}): Promise<boolean> {
  return withActivityTransaction(async (db) => {
    const activityInput = input.activity;
    const activity = activityInput
      ? await captureActivityContext(db, {
          eventKey: "kills.submitted",
          identity: activityInput.identity,
          alliance: input.allianceId
            ? { kind: "hq", id: input.allianceId }
            : null,
          actingMemberId: input.ashedMemberId,
          method: activityInput.method,
        })
      : null;
    if (
      activity &&
      activityInput &&
      (!input.allianceId ||
        !input.ashedMemberId ||
        activity.actor.commanderId !== input.commanderId ||
        (activityInput.identity.kind === "web" &&
          (input.hqUserId !== activity.actor.hqUserId ||
            activityInput.identity.principal.currentAllianceId !==
              input.allianceId)) ||
        (activityInput.identity.kind === "discord" &&
          input.discordUserId !== activity.actor.discordUserId))
    ) {
      throw new ActivityWriteError({
        eventKey: "kills.submitted",
        failureCategory: "validation",
      });
    }

    if (activityInput?.pending) {
      const expectedJson = JSON.stringify(activityInput.pending.expected);
      const consumed =
        activityInput.identity.kind === "web"
          ? await db
              .delete(schema.hqKillsPending)
              .where(
                and(
                  eq(schema.hqKillsPending.allianceId, input.allianceId!),
                  eq(schema.hqKillsPending.hqUserId, input.hqUserId!),
                  gt(schema.hqKillsPending.expiresAt, new Date()),
                  sql`${schema.hqKillsPending.pendingJson} = ${expectedJson}::jsonb`,
                ),
              )
              .returning()
          : await db
              .delete(schema.discordBotPending)
              .where(
                and(
                  eq(
                    schema.discordBotPending.discordUserId,
                    input.discordUserId!,
                  ),
                  eq(schema.discordBotPending.allianceId, input.allianceId!),
                  gt(schema.discordBotPending.expiresAt, new Date()),
                  sql`${schema.discordBotPending.pendingJson} = ${expectedJson}::jsonb`,
                ),
              )
              .returning();
      if (consumed.length === 0 && activityInput.pending.required) {
        throw new KillsPendingChangedError();
      }
    }

    const now = new Date();
    const [current] = await db
      .select({
        currentKills: schema.commanders.currentKills,
        killsUpdatedAt: schema.commanders.killsUpdatedAt,
        primaryName: schema.commanders.primaryName,
      })
      .from(schema.commanders)
      .where(eq(schema.commanders.id, input.commanderId))
      .limit(1)
      .for("update");
    if (!current) {
      throw new Error("commander_not_found");
    }
    const previousTotal = current.currentKills;

    if (previousTotal === input.total) {
      if (input.markAshedSynced) {
        await markLatestVideoParseKillsAshedSynced(input.commanderId, db);
      }
      return false;
    }

    const historyId = nanoid();
    await db.insert(schema.commanderKillsEvents).values({
      id: historyId,
      commanderId: input.commanderId,
      total: input.total,
      previousTotal,
      source: input.source,
      allianceId: input.allianceId ?? null,
      reportedByHqUserId: input.hqUserId ?? null,
      reportedByDiscordUserId: input.discordUserId ?? null,
      ashedSyncedAt: ashedSyncedAtForSource(
        input.source,
        now,
        input.markAshedSynced,
      ),
      createdAt: now,
    });

    await db
      .update(schema.commanders)
      .set({
        currentKills: input.total,
        killsUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, input.commanderId));

    if (activity) {
      await appendActivityEvent(db, {
        ...activity,
        eventKey: "kills.submitted",
        occurredAt: now,
        source: { namespace: "commander-kills-events", key: historyId },
        severity: "update",
        payload: {
          value: String(input.total),
          previousValue:
            previousTotal === null ? null : String(previousTotal),
        },
      });
    }

    return true;
  });
}

/** Mark the latest non-discarded video_parse kills event as already synced to Ashed. */
export async function markLatestVideoParseKillsAshedSynced(
  commanderId: string,
  tx?: ActivityTransaction,
): Promise<boolean> {
  const db = tx ?? getDb();
  const [latest] = await db
    .select({
      id: schema.commanderKillsEvents.id,
      source: schema.commanderKillsEvents.source,
      ashedSyncedAt: schema.commanderKillsEvents.ashedSyncedAt,
    })
    .from(schema.commanderKillsEvents)
    .where(
      and(
        eq(schema.commanderKillsEvents.commanderId, commanderId),
        isNull(schema.commanderKillsEvents.discardedAt),
      ),
    )
    .orderBy(desc(schema.commanderKillsEvents.createdAt))
    .limit(1);

  if (!latest || latest.source !== "video_parse" || latest.ashedSyncedAt) {
    return false;
  }

  await db
    .update(schema.commanderKillsEvents)
    .set({ ashedSyncedAt: new Date() })
    .where(eq(schema.commanderKillsEvents.id, latest.id));
  return true;
}

/**
 * Discard the latest video_parse kills event and restore previousTotal when it
 * still matches commander.currentKills (re-submit removed this member).
 *
 * When `expectedTotal` is provided, only revert if both current kills and the
 * latest event total still equal that prior-batch score. This prevents
 * re-submitting an older KillScore date from discarding a newer day's event
 * (same commander, higher/different total).
 */
export async function revertLatestVideoParseKillsIfStillCurrent(
  commanderId: string,
  expectedTotal?: number,
): Promise<boolean> {
  const db = getDb();
  const state = await getCommanderKillsState(commanderId);
  const [latest] = await db
    .select()
    .from(schema.commanderKillsEvents)
    .where(
      and(
        eq(schema.commanderKillsEvents.commanderId, commanderId),
        isNull(schema.commanderKillsEvents.discardedAt),
      ),
    )
    .orderBy(desc(schema.commanderKillsEvents.createdAt))
    .limit(1);

  if (!latest || latest.source !== "video_parse") {
    return false;
  }
  if (
    expectedTotal != null &&
    (latest.total !== expectedTotal || state?.currentKills !== expectedTotal)
  ) {
    return false;
  }
  if (state?.currentKills !== latest.total) {
    return false;
  }

  const now = new Date();
  await db
    .update(schema.commanderKillsEvents)
    .set({ discardedAt: now })
    .where(eq(schema.commanderKillsEvents.id, latest.id));

  await db
    .update(schema.commanders)
    .set({
      currentKills: latest.previousTotal,
      killsUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, commanderId));

  return true;
}

export async function getHqKillsPending(
  allianceId: string,
  hqUserId: string,
): Promise<KillsPendingState | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqKillsPending)
    .where(
      and(
        eq(schema.hqKillsPending.allianceId, allianceId),
        eq(schema.hqKillsPending.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(schema.hqKillsPending)
      .where(
        and(
          eq(schema.hqKillsPending.allianceId, allianceId),
          eq(schema.hqKillsPending.hqUserId, hqUserId),
        ),
      );
    return null;
  }
  return parseStoredKillsPending(row.pendingJson);
}

export async function saveHqKillsPending(
  allianceId: string,
  hqUserId: string,
  pending: KillsPendingState | null,
): Promise<void> {
  const db = getDb();
  if (!pending) {
    await db
      .delete(schema.hqKillsPending)
      .where(
        and(
          eq(schema.hqKillsPending.allianceId, allianceId),
          eq(schema.hqKillsPending.hqUserId, hqUserId),
        ),
      );
    return;
  }
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db
    .insert(schema.hqKillsPending)
    .values({
      allianceId,
      hqUserId,
      pendingJson: pending as unknown as Record<string, unknown>,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.hqKillsPending.allianceId, schema.hqKillsPending.hqUserId],
      set: {
        pendingJson: pending as unknown as Record<string, unknown>,
        expiresAt,
        updatedAt: new Date(),
      },
    });
}

export async function countAllianceKillsReporters(
  allianceId: string,
): Promise<number> {
  const rows = await listAllianceCommanderKillsRows(allianceId);
  return rows.filter((row) => row.total != null && row.total > 0).length;
}
