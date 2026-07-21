import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { LevelEventSource } from "@/lib/member-level/constants";
import { clampMemberHqLevel } from "@/lib/members/member-level.shared";

export { getCommanderIdForMember } from "@/lib/thp/repository";
export { getCommanderMembershipInAlliance } from "@/lib/thp/repository";

const HQ_SOURCES_PENDING_ASHED_SYNC = new Set<LevelEventSource>([
  "web",
  "discord",
  "video_parse",
  "screenshot_ocr",
  "roster_import",
  "manual",
]);

function ashedSyncedAtForSource(
  source: LevelEventSource,
  now: Date,
): Date | null {
  if (source === "ashed_sync" || source === "officer_override") {
    return now;
  }
  if (HQ_SOURCES_PENDING_ASHED_SYNC.has(source)) {
    return null;
  }
  return null;
}

export async function getCommanderLevelState(commanderId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      memberLevel: schema.commanders.memberLevel,
      levelUpdatedAt: schema.commanders.levelUpdatedAt,
      primaryName: schema.commanders.primaryName,
    })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, commanderId))
    .limit(1);
  return row ?? null;
}

export async function listAllianceCommanderLevelRows(allianceId: string) {
  const db = getDb();
  return db
    .select({
      commanderId: schema.commanders.id,
      total: schema.commanders.memberLevel,
    })
    .from(schema.commanders)
    .where(
      and(
        eq(schema.commanders.currentAllianceId, allianceId),
        isNotNull(schema.commanders.memberLevel),
      ),
    );
}

export async function listCommanderLevelEvents(commanderId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.commanderLevelEvents)
    .where(eq(schema.commanderLevelEvents.commanderId, commanderId))
    .orderBy(asc(schema.commanderLevelEvents.createdAt));
}

export async function upsertCommanderLevel(input: {
  commanderId: string;
  total: number;
  allianceId?: string | null;
  ashedMemberId?: string | null;
  memberName?: string | null;
  source: LevelEventSource;
  hqUserId?: string | null;
  discordUserId?: string | null;
}): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const total = clampMemberHqLevel(input.total);
  const current = await getCommanderLevelState(input.commanderId);
  const previousTotal = current?.memberLevel ?? null;

  if (previousTotal === total) {
    return false;
  }

  await db.insert(schema.commanderLevelEvents).values({
    id: nanoid(),
    commanderId: input.commanderId,
    total,
    previousTotal,
    source: input.source,
    allianceId: input.allianceId ?? null,
    reportedByHqUserId: input.hqUserId ?? null,
    reportedByDiscordUserId: input.discordUserId ?? null,
    ashedSyncedAt: ashedSyncedAtForSource(input.source, now),
    discardedAt: null,
    createdAt: now,
  });

  await db
    .update(schema.commanders)
    .set({
      memberLevel: total,
      levelUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, input.commanderId));

  return true;
}

export async function listAllianceCommanderLevelEvents(allianceId: string) {
  const db = getDb();
  const commanders = await listAllianceCommanderLevelRows(allianceId);
  if (commanders.length === 0) {
    return new Map<
      string,
      Array<{ commanderId: string; total: number; createdAt: Date }>
    >();
  }
  const commanderIds = commanders.map((row) => row.commanderId);
  const events = await db
    .select({
      commanderId: schema.commanderLevelEvents.commanderId,
      total: schema.commanderLevelEvents.total,
      createdAt: schema.commanderLevelEvents.createdAt,
    })
    .from(schema.commanderLevelEvents)
    .where(inArray(schema.commanderLevelEvents.commanderId, commanderIds))
    .orderBy(asc(schema.commanderLevelEvents.createdAt));

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
