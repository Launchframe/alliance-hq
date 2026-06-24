import "server-only";

import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import {
  DEFAULT_MAX_BASE_VR,
  gameSeasonIdForNumber,
  gameServerIdForNumber,
} from "@/lib/game-season/game-servers.shared";
import { getDb, schema } from "@/lib/db";

export {
  ABSOLUTE_VR_CEILING,
  DEFAULT_MAX_BASE_VR,
  gameSeasonIdForNumber,
  gameServerIdForNumber,
} from "@/lib/game-season/game-servers.shared";

export async function ensureGameSeason(seasonNumber: number): Promise<string> {
  const db = getDb();
  const normalized = Math.max(1, Math.floor(seasonNumber));
  const id = gameSeasonIdForNumber(normalized);
  const now = new Date();

  await db
    .insert(schema.gameSeasons)
    .values({
      id,
      seasonNumber: normalized,
      maxBaseVr: DEFAULT_MAX_BASE_VR,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  return id;
}

export async function upsertGameServerByNumber(
  serverNumber: number,
  input?: {
    seasonNumber?: number;
    openTimestampMs?: number | null;
    seasonKeyOverride?: string | null;
    seasonKeySynced?: string | null;
    seasonKeySource?: string | null;
    seasonIsPostSeason?: number;
    seasonWeek?: number | null;
  },
): Promise<string> {
  const db = getDb();
  const normalizedServer = Math.floor(serverNumber);
  if (normalizedServer <= 0) {
    throw new Error("Invalid game server number");
  }

  const seasonNumber = input?.seasonNumber ?? 1;
  const seasonId = await ensureGameSeason(seasonNumber);
  const id = gameServerIdForNumber(normalizedServer);
  const now = new Date();

  await db
    .insert(schema.gameServers)
    .values({
      id,
      serverNumber: normalizedServer,
      seasonId,
      openTimestampMs: input?.openTimestampMs ?? null,
      seasonKeyOverride: input?.seasonKeyOverride ?? null,
      seasonKeySynced: input?.seasonKeySynced ?? String(seasonNumber),
      seasonKeySource: input?.seasonKeySource ?? "default",
      seasonIsPostSeason: input?.seasonIsPostSeason ?? 0,
      seasonWeek: input?.seasonWeek ?? null,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.gameServers.serverNumber,
      set: {
        ...(input?.seasonNumber != null ? { seasonId } : {}),
        ...(input?.openTimestampMs !== undefined
          ? { openTimestampMs: input.openTimestampMs }
          : {}),
        ...(input?.seasonKeyOverride !== undefined
          ? { seasonKeyOverride: input.seasonKeyOverride }
          : {}),
        ...(input?.seasonKeySynced !== undefined
          ? { seasonKeySynced: input.seasonKeySynced }
          : {}),
        ...(input?.seasonKeySource !== undefined
          ? { seasonKeySource: input.seasonKeySource }
          : {}),
        ...(input?.seasonIsPostSeason !== undefined
          ? { seasonIsPostSeason: input.seasonIsPostSeason }
          : {}),
        ...(input?.seasonWeek !== undefined ? { seasonWeek: input.seasonWeek } : {}),
        syncedAt: now,
        updatedAt: now,
      },
    });

  return id;
}

export async function linkAllianceToGameServer(
  allianceId: string,
  serverNumber: number,
): Promise<void> {
  const gameServerId = await upsertGameServerByNumber(serverNumber);
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      gameServerId,
      gameServerNumber: serverNumber,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));
}

export async function resolveAllianceGameServerNumber(
  allianceId: string,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({
      gameServerNumber: schema.alliances.gameServerNumber,
      serverNumber: schema.gameServers.serverNumber,
    })
    .from(schema.alliances)
    .leftJoin(
      schema.gameServers,
      eq(schema.alliances.gameServerId, schema.gameServers.id),
    )
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return row?.serverNumber ?? row?.gameServerNumber ?? null;
}

export async function resolveMaxBaseVrForAlliance(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [alliance] = await db
    .select({
      gameServerId: schema.alliances.gameServerId,
      gameServerNumber: schema.alliances.gameServerNumber,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!alliance) {
    return DEFAULT_MAX_BASE_VR;
  }

  const serverId =
    alliance.gameServerId ??
    (alliance.gameServerNumber != null
      ? gameServerIdForNumber(alliance.gameServerNumber)
      : null);

  if (!serverId) {
    return DEFAULT_MAX_BASE_VR;
  }

  const [row] = await db
    .select({ maxBaseVr: schema.gameSeasons.maxBaseVr })
    .from(schema.gameServers)
    .innerJoin(
      schema.gameSeasons,
      eq(schema.gameServers.seasonId, schema.gameSeasons.id),
    )
    .where(eq(schema.gameServers.id, serverId))
    .limit(1);

  return row?.maxBaseVr ?? DEFAULT_MAX_BASE_VR;
}

export async function ensureGameServersForSeasonCron(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ gameServerNumber: schema.alliances.gameServerNumber })
    .from(schema.alliances)
    .where(isNotNull(schema.alliances.gameServerNumber));

  const seen = new Set<number>();
  for (const row of rows) {
    const serverNumber = row.gameServerNumber;
    if (serverNumber == null || seen.has(serverNumber)) {
      continue;
    }
    seen.add(serverNumber);
    await upsertGameServerByNumber(serverNumber);
  }
}

export async function listGameServersForSeasonCron(): Promise<
  Array<{ id: string; serverNumber: number }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.gameServers.id,
      serverNumber: schema.gameServers.serverNumber,
      seasonKeyOverride: schema.gameServers.seasonKeyOverride,
    })
    .from(schema.gameServers);

  return rows
    .filter((row) => !row.seasonKeyOverride?.trim())
    .map((row) => ({ id: row.id, serverNumber: row.serverNumber }));
}

export async function mirrorServerSeasonToAlliances(
  gameServerId: string,
  patch: {
    currentSeasonKey: string;
    seasonKeySynced: string;
    seasonKeySource: string;
    gameServerOpenTimestamp?: number | null;
    seasonIsPostSeason?: number;
    seasonWeek?: number | null;
  },
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.alliances)
    .set({
      currentSeasonKey: patch.currentSeasonKey,
      seasonKeySynced: patch.seasonKeySynced,
      seasonKeySource: patch.seasonKeySource,
      seasonSyncedAt: now,
      updatedAt: now,
      ...(patch.gameServerOpenTimestamp !== undefined
        ? { gameServerOpenTimestamp: patch.gameServerOpenTimestamp }
        : {}),
      ...(patch.seasonIsPostSeason !== undefined
        ? { seasonIsPostSeason: patch.seasonIsPostSeason }
        : {}),
      ...(patch.seasonWeek !== undefined ? { seasonWeek: patch.seasonWeek } : {}),
    })
    .where(
      and(
        eq(schema.alliances.gameServerId, gameServerId),
        or(
          isNull(schema.alliances.seasonKeyOverride),
          eq(schema.alliances.seasonKeyOverride, ""),
        ),
      ),
    );
}
