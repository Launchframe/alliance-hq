import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCaptureEvent,
  loadBattlePlanRows,
} from "@/lib/battle-plan/repository.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { getDb, schema } from "@/lib/db";

const databaseUrl =
  process.env.E2E_DATABASE_URL?.trim() ||
  process.env.LOCAL_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

const describeIntegration = databaseUrl ? describe : describe.skip;

function scheduledAtOnServerDate(serverDate: string, hour = 14): string {
  return `${serverDate}T${String(hour).padStart(2, "0")}:00:00.000-02:00`;
}

async function createAlliance() {
  const db = getDb();
  const now = new Date();
  const allianceId = nanoid(16);
  const tag = `BP${randomBytes(2).toString("hex").toUpperCase()}`;
  const gameServerNumber = 1203;
  const gameServerId = `server-${gameServerNumber}`;

  await db
    .insert(schema.gameSeasons)
    .values({
      id: "season-1",
      seasonNumber: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.gameServers)
    .values({
      id: gameServerId,
      serverNumber: gameServerNumber,
      seasonId: "season-1",
      seasonKeySynced: "1",
      seasonKeySource: "default",
      seasonIsPostSeason: 0,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db.insert(schema.alliances).values({
    id: allianceId,
    slug: `battle-plan-${nanoid(6)}`,
    tag,
    name: `Battle Plan ${tag}`,
    gameServerId,
    gameServerNumber,
    operatingMode: "native",
    createdAt: now,
    updatedAt: now,
  });

  return allianceId;
}

describeIntegration("battle plan repository", () => {
  const allianceIds: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const allianceId of allianceIds.splice(0)) {
      await db
        .delete(schema.alliances)
        .where(eq(schema.alliances.id, allianceId));
    }
  });

  it("rolls back revision bump when server-day limit is exceeded", async () => {
    const allianceId = await createAlliance();
    allianceIds.push(allianceId);

    const rows = await loadBattlePlanRows(allianceId);
    let planRevision = rows.settings.planRevision;
    const serverDate = getServerCalendarDate();

    await createCaptureEvent(allianceId, null, {
      scheduledAt: scheduledAtOnServerDate(serverDate, 11),
      territoryType: "stronghold",
      markerNumber: 1,
      planRevision,
    });
    planRevision += 1;

    await createCaptureEvent(allianceId, null, {
      scheduledAt: scheduledAtOnServerDate(serverDate, 12),
      territoryType: "stronghold",
      markerNumber: 2,
      planRevision,
    });
    planRevision += 1;

    await expect(
      createCaptureEvent(allianceId, null, {
        scheduledAt: scheduledAtOnServerDate(serverDate, 13),
        territoryType: "stronghold",
        markerNumber: 3,
        planRevision,
      }),
    ).rejects.toThrow(/already has 2 scheduled stronghold captures/i);

    const after = await loadBattlePlanRows(allianceId);
    expect(after.settings.planRevision).toBe(planRevision);
    expect(
      after.events.filter(
        (event) =>
          event.serverCalendarDate === serverDate &&
          event.territoryType === "stronghold" &&
          event.status === "scheduled",
      ),
    ).toHaveLength(2);
  });
});
