import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { deriveShinySpawnWeekdays } from "@/lib/vs-calculator/shiny-schedule.shared";

export async function syncShinySpawnWeekdaysForGameServer(
  gameServerId: string,
  openTimestampMs: number | null | undefined,
): Promise<void> {
  if (openTimestampMs == null || openTimestampMs <= 0) return;

  const [a, b] = deriveShinySpawnWeekdays(openTimestampMs);
  const db = getDb();
  await db
    .update(schema.gameServers)
    .set({
      shinySpawnWeekdayA: a,
      shinySpawnWeekdayB: b,
      updatedAt: new Date(),
    })
    .where(eq(schema.gameServers.id, gameServerId));
}

export async function resolveShinyWeekdaysForAlliance(
  allianceId: string,
): Promise<[number, number] | null> {
  const db = getDb();
  const [row] = await db
    .select({
      shinyA: schema.gameServers.shinySpawnWeekdayA,
      shinyB: schema.gameServers.shinySpawnWeekdayB,
      openTimestampMs: schema.gameServers.openTimestampMs,
      gameServerOpenTimestamp: schema.alliances.gameServerOpenTimestamp,
    })
    .from(schema.alliances)
    .innerJoin(
      schema.gameServers,
      eq(schema.alliances.gameServerId, schema.gameServers.id),
    )
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!row) return null;

  if (row.shinyA != null && row.shinyB != null) {
    return [row.shinyA, row.shinyB];
  }

  const openTs = row.openTimestampMs ?? row.gameServerOpenTimestamp;
  if (openTs == null || openTs <= 0) return null;

  return deriveShinySpawnWeekdays(openTs);
}
