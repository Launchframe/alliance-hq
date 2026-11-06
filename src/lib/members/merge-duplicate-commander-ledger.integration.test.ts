import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getDb, resetDbPool, schema } from "@/lib/db";
import { mergeDuplicateCommander } from "@/lib/members/merge-duplicate-commander.server";
import { NATIVE_ROSTER_ASHED_ALLIANCE_ID } from "@/lib/native-alliance/constants";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";

const enabled = process.env.MERGE_DUPLICATE_DB_TEST === "1";
const PREFIX = "merge-dup-ledger";

describe.skipIf(!enabled)("merge-duplicate commander ledger remap (DB)", () => {
  const allianceIds: string[] = [];
  const commanderIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(() => {
    const urls = [
      process.env.DATABASE_URL,
      process.env.LOCAL_DATABASE_URL,
      process.env.E2E_DATABASE_URL,
    ].filter((url): url is string => typeof url === "string" && url.length > 0);
    if (urls.length !== 3 || new Set(urls).size !== 1) {
      throw new Error(
        "Merge-duplicate ledger integration requires one guarded database URL on DATABASE_URL, LOCAL_DATABASE_URL, and E2E_DATABASE_URL.",
      );
    }
    for (const url of urls) assertE2eDatabaseUrl(url);
  });

  afterEach(async () => {
    const db = getDb();
    if (eventIds.length) {
      await db
        .delete(schema.hqEvents)
        .where(inArray(schema.hqEvents.id, eventIds.splice(0)));
    }
    if (allianceIds.length) {
      const ids = allianceIds.splice(0);
      await db
        .delete(schema.allianceMembers)
        .where(inArray(schema.allianceMembers.allianceId, ids));
      await db
        .delete(schema.commanderAllianceMemberships)
        .where(inArray(schema.commanderAllianceMemberships.allianceId, ids));
      await db.delete(schema.alliances).where(inArray(schema.alliances.id, ids));
    }
    if (commanderIds.length) {
      await db
        .delete(schema.commanders)
        .where(inArray(schema.commanders.id, commanderIds.splice(0)));
    }
  });

  afterAll(async () => {
    await resetDbPool();
  });

  it("remaps event observations and keeps the kept-side result on collision", async () => {
    const db = getDb();
    const now = new Date();
    const allianceId = `${PREFIX}-alliance-${randomUUID()}`;
    const keptCommanderId = `${PREFIX}-cmd-kept-${randomUUID()}`;
    const dupCommanderId = `${PREFIX}-cmd-dup-${randomUUID()}`;
    const keptMemberId = `${PREFIX}-kept-${randomUUID()}`;
    const dupMemberId = `${PREFIX}-dup-${randomUUID()}`;
    const ashedAllianceId = `${NATIVE_ROSTER_ASHED_ALLIANCE_ID}:${allianceId}`;
    const eventId = `${PREFIX}-event-${randomUUID()}`;
    const boardId = `${PREFIX}-board-${randomUUID()}`;
    const batchId = `${PREFIX}-batch-${randomUUID()}`;
    const observationId = `${PREFIX}-obs-${randomUUID()}`;
    const keptResultId = `${PREFIX}-result-kept-${randomUUID()}`;
    const dupResultId = `${PREFIX}-result-dup-${randomUUID()}`;
    const soloDupResultId = `${PREFIX}-result-solo-${randomUUID()}`;
    const soloBoardId = `${PREFIX}-board-solo-${randomUUID()}`;

    allianceIds.push(allianceId);
    commanderIds.push(keptCommanderId, dupCommanderId);
    eventIds.push(eventId);

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
        id: "server-1203",
        serverNumber: 1203,
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
      slug: allianceId,
      tag: `MD${randomUUID().slice(0, 4)}`,
      name: "Merge dup ledger fixture",
      operatingMode: "native",
      gameServerNumber: 1203,
      gameServerId: "server-1203",
      createdAt: now,
      updatedAt: now,
    });

    for (const [commanderId, memberId, name] of [
      [keptCommanderId, keptMemberId, "Kept Player"] as const,
      [dupCommanderId, dupMemberId, "Dup Player"] as const,
    ]) {
      await db.insert(schema.commanders).values({
        id: commanderId,
        primaryName: name,
        primaryNameNormalized: name.toLowerCase(),
        gameServerNumber: 1203,
        currentAllianceId: allianceId,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.allianceMembers).values({
        id: `${PREFIX}-roster-${memberId}`,
        allianceId,
        ashedMemberId: memberId,
        ashedAllianceId,
        currentName: name,
        status: "active",
        commanderSyncStatus: "synced",
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.commanderAllianceMemberships).values({
        id: `${PREFIX}-cam-${memberId}`,
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        ashedAllianceId,
        status: "active",
        rosterNameAtMembership: name,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(schema.hqEvents).values({
      id: eventId,
      allianceId,
      scoreTarget: "points",
      name: "Merge ledger event",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.hqEventBoards).values([
      {
        id: boardId,
        allianceId,
        hqEventId: eventId,
        boardKey: "main",
        name: "Main",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: soloBoardId,
        allianceId,
        hqEventId: eventId,
        boardKey: "solo",
        name: "Solo",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.hqEventEvidenceBatches).values({
      id: batchId,
      allianceId,
      hqEventId: eventId,
      boardId,
      sourceKind: "manual",
      status: "committed",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.hqEventObservations).values({
      id: observationId,
      allianceId,
      hqEventId: eventId,
      boardId,
      batchId,
      revision: 1,
      sourceRowKey: `${PREFIX}-row`,
      memberId: dupMemberId,
      memberName: "Dup Player",
      evidenceKind: "leaderboard",
      realScore: "1000",
      provenance: "manual",
      createdAt: now,
    });
    await db.insert(schema.hqEventMemberResults).values([
      {
        id: keptResultId,
        allianceId,
        hqEventId: eventId,
        boardId,
        memberId: keptMemberId,
        memberName: "Kept Player",
        realScore: "2000",
        evidenceClass: "real",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: dupResultId,
        allianceId,
        hqEventId: eventId,
        boardId,
        memberId: dupMemberId,
        memberName: "Dup Player",
        realScore: "1000",
        evidenceClass: "real",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: soloDupResultId,
        allianceId,
        hqEventId: eventId,
        boardId: soloBoardId,
        memberId: dupMemberId,
        memberName: "Dup Player",
        realScore: "500",
        evidenceClass: "real",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await mergeDuplicateCommander({
      allianceId,
      keptAshedMemberId: keptMemberId,
      duplicateAshedMemberId: dupMemberId,
      keepName: "kept",
      actorHqUserId: null,
      sessionId: null,
    });
    expect(result.ok).toBe(true);

    const [observation] = await db
      .select()
      .from(schema.hqEventObservations)
      .where(eq(schema.hqEventObservations.id, observationId));
    expect(observation?.memberId).toBe(keptMemberId);
    expect(observation?.memberName).toBe("Kept Player");

    const colliding = await db
      .select({ id: schema.hqEventMemberResults.id })
      .from(schema.hqEventMemberResults)
      .where(
        and(
          eq(schema.hqEventMemberResults.hqEventId, eventId),
          eq(schema.hqEventMemberResults.boardId, boardId),
        ),
      );
    expect(colliding.map((row) => row.id).sort()).toEqual([keptResultId]);

    const [solo] = await db
      .select()
      .from(schema.hqEventMemberResults)
      .where(eq(schema.hqEventMemberResults.id, soloDupResultId));
    expect(solo?.memberId).toBe(keptMemberId);
    expect(solo?.memberName).toBe("Kept Player");

    const [dupRoster] = await db
      .select({ status: schema.allianceMembers.status })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, allianceId),
          eq(schema.allianceMembers.ashedMemberId, dupMemberId),
        ),
      );
    expect(dupRoster?.status).toBe("former");
  }, 60_000);
});
