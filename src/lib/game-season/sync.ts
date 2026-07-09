import { eq, isNotNull } from "drizzle-orm";

import { fetchCptHedgeServerRecord } from "@/lib/game-season/cpt-hedge";
import {
  ensureGameSeason,
  mirrorServerSeasonToAlliances,
  upsertGameServerByNumber,
  linkAllianceToGameServer,
} from "@/lib/game-season/game-servers.server";
import {
  normalizeSeasonKey,
  resolveEffectiveSeasonFromRow,
  resolveSeasonFromAgeFallback,
  resolveSeasonFromCptHedgeRecord,
} from "@/lib/game-season/resolve";
import type { AllianceSeasonRow, EffectiveSeason } from "@/lib/game-season/types";
import { getDb, schema } from "@/lib/db";

const allianceSeasonSelect = {
  id: schema.alliances.id,
  currentSeasonKey: schema.alliances.currentSeasonKey,
  gameServerNumber: schema.alliances.gameServerNumber,
  gameServerOpenTimestamp: schema.alliances.gameServerOpenTimestamp,
  seasonKeyOverride: schema.alliances.seasonKeyOverride,
  seasonKeySynced: schema.alliances.seasonKeySynced,
  seasonKeySource: schema.alliances.seasonKeySource,
  seasonSyncedAt: schema.alliances.seasonSyncedAt,
  seasonIsPostSeason: schema.alliances.seasonIsPostSeason,
  seasonWeek: schema.alliances.seasonWeek,
};

export async function loadAllianceSeasonRow(
  allianceId: string,
): Promise<AllianceSeasonRow | null> {
  const db = getDb();
  const [row] = await db
    .select(allianceSeasonSelect)
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row ?? null;
}

export async function getEffectiveSeasonForAlliance(
  allianceId: string,
): Promise<EffectiveSeason> {
  const row = await loadAllianceSeasonRow(allianceId);
  if (!row) {
    return {
      seasonKey: "1",
      source: "default",
      isPostSeason: false,
      week: null,
      gameServerNumber: null,
    };
  }
  return resolveEffectiveSeasonFromRow(row);
}

async function persistSeasonSync(
  allianceId: string,
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
    .where(eq(schema.alliances.id, allianceId));
}

export type SeasonSyncOptions = {
  /** Bypass in-memory cpt-hedge cache (explicit resync / clear override). */
  forceRefresh?: boolean;
};

export async function applyGameServerSeasonSync(
  gameServerId: string,
  serverNumber: number,
  options: SeasonSyncOptions = {},
): Promise<EffectiveSeason> {
  const db = getDb();
  const [serverRow] = await db
    .select({
      seasonKeyOverride: schema.gameServers.seasonKeyOverride,
      openTimestampMs: schema.gameServers.openTimestampMs,
    })
    .from(schema.gameServers)
    .where(eq(schema.gameServers.id, gameServerId))
    .limit(1);

  if (!serverRow) {
    throw new Error(`Game server not found: ${gameServerId}`);
  }

  if (serverRow.seasonKeyOverride?.trim()) {
    const seasonKey = normalizeSeasonKey(serverRow.seasonKeyOverride);
    const seasonNumber = Math.max(1, parseInt(seasonKey, 10) || 1);
    const seasonId = await ensureGameSeason(seasonNumber);
    const now = new Date();
    await db
      .update(schema.gameServers)
      .set({
        seasonId,
        seasonKeySource: "override",
        syncedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.gameServers.id, gameServerId));
    await mirrorServerSeasonToAlliances(gameServerId, {
      currentSeasonKey: seasonKey,
      seasonKeySynced: seasonKey,
      seasonKeySource: "override",
    });
    return {
      seasonKey,
      source: "override",
      isPostSeason: false,
      week: null,
      gameServerNumber: serverNumber,
    };
  }

  try {
    const cptRecord = await fetchCptHedgeServerRecord(
      serverNumber,
      options.forceRefresh,
    );
    if (cptRecord) {
      const resolved = resolveSeasonFromCptHedgeRecord(cptRecord);
      const seasonNumber = Math.max(1, parseInt(resolved.seasonKey, 10) || 1);
      const seasonId = await ensureGameSeason(seasonNumber);
      const now = new Date();
      await db
        .update(schema.gameServers)
        .set({
          seasonId,
          openTimestampMs: resolved.openTimestampMs,
          seasonKeySynced: resolved.seasonKey,
          seasonKeySource: resolved.source,
          seasonIsPostSeason: resolved.isPostSeason ? 1 : 0,
          seasonWeek: resolved.week,
          syncedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.gameServers.id, gameServerId));
      await mirrorServerSeasonToAlliances(gameServerId, {
        currentSeasonKey: resolved.seasonKey,
        seasonKeySynced: resolved.seasonKey,
        seasonKeySource: resolved.source,
        gameServerOpenTimestamp: resolved.openTimestampMs,
        seasonIsPostSeason: resolved.isPostSeason ? 1 : 0,
        seasonWeek: resolved.week,
      });
      return {
        seasonKey: resolved.seasonKey,
        source: resolved.source,
        isPostSeason: resolved.isPostSeason,
        week: resolved.week,
        gameServerNumber: serverNumber,
      };
    }
  } catch (error) {
    console.warn("[game-season] cpt-hedge server sync failed", gameServerId, error);
  }

  const openTs = serverRow.openTimestampMs;
  if (openTs != null && openTs > 0) {
    const resolved = resolveSeasonFromAgeFallback(openTs);
    const seasonNumber = Math.max(1, parseInt(resolved.seasonKey, 10) || 1);
    const seasonId = await ensureGameSeason(seasonNumber);
    const now = new Date();
    await db
      .update(schema.gameServers)
      .set({
        seasonId,
        seasonKeySynced: resolved.seasonKey,
        seasonKeySource: resolved.source,
        seasonIsPostSeason: 0,
        seasonWeek: null,
        syncedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.gameServers.id, gameServerId));
    await mirrorServerSeasonToAlliances(gameServerId, {
      currentSeasonKey: resolved.seasonKey,
      seasonKeySynced: resolved.seasonKey,
      seasonKeySource: resolved.source,
      gameServerOpenTimestamp: openTs,
      seasonIsPostSeason: 0,
      seasonWeek: null,
    });
    return {
      seasonKey: resolved.seasonKey,
      source: resolved.source,
      isPostSeason: false,
      week: null,
      gameServerNumber: serverNumber,
    };
  }

  const fallbackKey = "1";
  const seasonId = await ensureGameSeason(1);
  const now = new Date();
  await db
    .update(schema.gameServers)
    .set({
      seasonId,
      seasonKeySynced: fallbackKey,
      seasonKeySource: "default",
      seasonIsPostSeason: 0,
      seasonWeek: null,
      syncedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.gameServers.id, gameServerId));
  await mirrorServerSeasonToAlliances(gameServerId, {
    currentSeasonKey: fallbackKey,
    seasonKeySynced: fallbackKey,
    seasonKeySource: "default",
    seasonIsPostSeason: 0,
    seasonWeek: null,
  });

  return {
    seasonKey: fallbackKey,
    source: "default",
    isPostSeason: false,
    week: null,
    gameServerNumber: serverNumber,
  };
}

export async function applySeasonSync(
  allianceId: string,
  options: SeasonSyncOptions = {},
): Promise<EffectiveSeason> {
  const db = getDb();
  const row = await loadAllianceSeasonRow(allianceId);
  if (!row) {
    throw new Error(`Alliance not found: ${allianceId}`);
  }

  if (row.gameServerNumber != null) {
    const gameServerId = await upsertGameServerByNumber(row.gameServerNumber);
    await db
      .update(schema.alliances)
      .set({ gameServerId, updatedAt: new Date() })
      .where(eq(schema.alliances.id, allianceId));
    return applyGameServerSeasonSync(
      gameServerId,
      row.gameServerNumber,
      options,
    );
  }

  if (row.seasonKeyOverride?.trim()) {
    const effective = resolveEffectiveSeasonFromRow(row);
    await persistSeasonSync(allianceId, {
      currentSeasonKey: effective.seasonKey,
      seasonKeySynced: row.seasonKeySynced ?? effective.seasonKey,
      seasonKeySource: "override",
      seasonIsPostSeason: row.seasonIsPostSeason,
      seasonWeek: row.seasonWeek,
    });
    return effective;
  }

  const openTs = row.gameServerOpenTimestamp;

  if (openTs != null && openTs > 0) {
    const resolved = resolveSeasonFromAgeFallback(openTs);
    await persistSeasonSync(allianceId, {
      currentSeasonKey: resolved.seasonKey,
      seasonKeySynced: resolved.seasonKey,
      seasonKeySource: resolved.source,
      seasonIsPostSeason: 0,
      seasonWeek: null,
    });
    return {
      seasonKey: resolved.seasonKey,
      source: resolved.source,
      isPostSeason: false,
      week: null,
      gameServerNumber: row.gameServerNumber,
    };
  }

  const fallbackKey = normalizeSeasonKey(row.currentSeasonKey);
  await persistSeasonSync(allianceId, {
    currentSeasonKey: fallbackKey,
    seasonKeySynced: fallbackKey,
    seasonKeySource: "default",
    seasonIsPostSeason: 0,
    seasonWeek: null,
  });

  return {
    seasonKey: fallbackKey,
    source: "default",
    isPostSeason: false,
    week: null,
    gameServerNumber: row.gameServerNumber,
  };
}

export async function setAllianceSeasonOverride(
  allianceId: string,
  seasonKeyOverride: string | null,
): Promise<EffectiveSeason> {
  const db = getDb();
  const now = new Date();
  const trimmed = seasonKeyOverride?.trim() ?? null;
  const normalized = trimmed ? normalizeSeasonKey(trimmed) : null;

  await db
    .update(schema.alliances)
    .set({
      seasonKeyOverride: normalized,
      updatedAt: now,
      ...(normalized
        ? {
            currentSeasonKey: normalized,
            seasonKeySource: "override",
          }
        : {}),
    })
    .where(eq(schema.alliances.id, allianceId));

  if (normalized) {
    const row = await loadAllianceSeasonRow(allianceId);
    return resolveEffectiveSeasonFromRow(row!);
  }

  return applySeasonSync(allianceId, { forceRefresh: true });
}

export async function updateAllianceGameServerNumber(
  allianceId: string,
  gameServerNumber: number,
): Promise<void> {
  await linkAllianceToGameServer(allianceId, gameServerNumber);
}

export async function listAlliancesForSeasonCron(): Promise<
  Array<{ id: string; gameServerNumber: number | null }>
> {
  const db = getDb();
  return db
    .select({
      id: schema.alliances.id,
      gameServerNumber: schema.alliances.gameServerNumber,
    })
    .from(schema.alliances)
    .where(
      isNotNull(schema.alliances.gameServerNumber),
    )
    .then((rows) =>
      rows.filter((row) => row.gameServerNumber != null),
    );
}

export async function listAlliancesWithSeasonOverride(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(isNotNull(schema.alliances.seasonKeyOverride));
  return rows.map((row) => row.id);
}
