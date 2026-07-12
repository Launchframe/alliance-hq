import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { KillsEventSource } from "@/lib/kills/constants";
import { parseStoredKillsPending } from "@/lib/kills/pending-state";
import type { KillsPendingState } from "@/lib/kills/types";

export { getCommanderIdForMember } from "@/lib/thp/repository";
export { getCommanderMembershipInAlliance } from "@/lib/thp/repository";

const PENDING_TTL_MS = 30 * 60 * 1000;

const HQ_SOURCES_PENDING_ASHED_SYNC = new Set<KillsEventSource>([
  "web",
  "discord",
  "video_parse",
  "screenshot_ocr",
]);

function ashedSyncedAtForSource(source: KillsEventSource, now: Date): Date | null {
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
}): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const current = await getCommanderKillsState(input.commanderId);
  const previousTotal = current?.currentKills ?? null;

  if (previousTotal === input.total) {
    return false;
  }

  await db.insert(schema.commanderKillsEvents).values({
    id: nanoid(),
    commanderId: input.commanderId,
    total: input.total,
    previousTotal,
    source: input.source,
    allianceId: input.allianceId ?? null,
    reportedByHqUserId: input.hqUserId ?? null,
    reportedByDiscordUserId: input.discordUserId ?? null,
    ashedSyncedAt: ashedSyncedAtForSource(input.source, now),
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
