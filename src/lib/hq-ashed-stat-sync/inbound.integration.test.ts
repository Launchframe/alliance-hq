import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/activity/monitoring.server", () => ({
  scheduleActivityBlockedAlert: vi.fn(),
}));

import { getDb, resetDbPool, schema } from "@/lib/db";

import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import type { ActivityTransaction } from "../activity/writer.server";
import { upsertCommanderKills } from "../kills/repository";
import { upsertCommanderLevel } from "../member-level/repository";
import { upsertCommanderThp } from "../thp/repository";
import { decideAndMaybeApplyInboundStat } from "./inbound";
import { killsStatSyncAdapter } from "./kills.adapter";
import { levelStatSyncAdapter } from "./level.adapter";
import { thpStatSyncAdapter } from "./thp.adapter";
import type { StatSyncAdapter } from "./types";

const enabled = process.env.ACTIVITY_DB_TEST === "1";

function uid(prefix: string) {
  return `stat-sync-it-${prefix}-${randomUUID()}`;
}

type WriteInput = {
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  total: number;
  source: "ashed_sync" | "web";
  tx?: ActivityTransaction;
};

type StatCase = {
  name: string;
  adapter: StatSyncAdapter;
  baseline: number;
  ashed: number;
  higherHq: number;
  write: (input: WriteInput) => Promise<boolean>;
  readCurrent: (commanderId: string) => Promise<number | null>;
  eventTotals: (commanderId: string) => Promise<
    { total: number; source: string }[]
  >;
};

const cases: StatCase[] = [
  {
    name: "kills",
    adapter: killsStatSyncAdapter,
    baseline: 100_000,
    ashed: 200_000,
    higherHq: 500_000,
    write: (input) =>
      upsertCommanderKills({ ...input, memberName: "Stat Sync IT" }),
    readCurrent: async (commanderId) => {
      const [row] = await getDb()
        .select({ value: schema.commanders.currentKills })
        .from(schema.commanders)
        .where(eq(schema.commanders.id, commanderId));
      return row?.value ?? null;
    },
    eventTotals: (commanderId) =>
      getDb()
        .select({
          total: schema.commanderKillsEvents.total,
          source: schema.commanderKillsEvents.source,
        })
        .from(schema.commanderKillsEvents)
        .where(eq(schema.commanderKillsEvents.commanderId, commanderId)),
  },
  {
    name: "thp",
    adapter: thpStatSyncAdapter,
    baseline: 100_000_000,
    ashed: 200_000_000,
    higherHq: 500_000_000,
    write: (input) =>
      upsertCommanderThp({
        ...input,
        breakdown: null,
        memberName: "Stat Sync IT",
      }),
    readCurrent: async (commanderId) => {
      const [row] = await getDb()
        .select({ value: schema.commanders.currentTotalHeroPower })
        .from(schema.commanders)
        .where(eq(schema.commanders.id, commanderId));
      return row?.value ?? null;
    },
    eventTotals: (commanderId) =>
      getDb()
        .select({
          total: schema.commanderThpEvents.total,
          source: schema.commanderThpEvents.source,
        })
        .from(schema.commanderThpEvents)
        .where(eq(schema.commanderThpEvents.commanderId, commanderId)),
  },
  {
    name: "level",
    adapter: levelStatSyncAdapter,
    baseline: 20,
    ashed: 25,
    higherHq: 30,
    write: (input) =>
      upsertCommanderLevel({ ...input, memberName: "Stat Sync IT" }),
    readCurrent: async (commanderId) => {
      const [row] = await getDb()
        .select({ value: schema.commanders.memberLevel })
        .from(schema.commanders)
        .where(eq(schema.commanders.id, commanderId));
      return row?.value ?? null;
    },
    eventTotals: (commanderId) =>
      getDb()
        .select({
          total: schema.commanderLevelEvents.total,
          source: schema.commanderLevelEvents.source,
        })
        .from(schema.commanderLevelEvents)
        .where(eq(schema.commanderLevelEvents.commanderId, commanderId)),
  },
];

describe.skipIf(!enabled)("inbound Ashed stat sync integration", () => {
  const createdCommanderIds: string[] = [];
  const createdAllianceIds: string[] = [];
  let guarded = false;

  beforeAll(() => {
    const urls = [
      process.env.DATABASE_URL,
      process.env.LOCAL_DATABASE_URL,
      process.env.E2E_DATABASE_URL,
    ].filter(
      (url): url is string => typeof url === "string" && url.length > 0,
    );
    if (urls.length !== 3 || new Set(urls).size !== 1) {
      throw new Error("Stat sync integration requires one guarded database.");
    }
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        throw new Error(
          "Stat sync integration requires one guarded database.",
        );
      }
      assertE2eDatabaseUrl(url);
    }
    guarded = true;
  });

  afterEach(async () => {
    if (!guarded) return;
    try {
      const db = getDb();
      const commanderIds = createdCommanderIds.splice(0);
      if (commanderIds.length > 0) {
        await db
          .delete(schema.hqAshedStatSyncConflicts)
          .where(
            inArray(schema.hqAshedStatSyncConflicts.commanderId, commanderIds),
          );
        await db
          .delete(schema.commanderKillsEvents)
          .where(inArray(schema.commanderKillsEvents.commanderId, commanderIds));
        await db
          .delete(schema.commanderThpEvents)
          .where(inArray(schema.commanderThpEvents.commanderId, commanderIds));
        await db
          .delete(schema.commanderLevelEvents)
          .where(inArray(schema.commanderLevelEvents.commanderId, commanderIds));
        await db
          .delete(schema.commanders)
          .where(inArray(schema.commanders.id, commanderIds));
      }
      for (const id of createdAllianceIds.splice(0)) {
        await db.delete(schema.alliances).where(eq(schema.alliances.id, id));
      }
    } finally {
      vi.restoreAllMocks();
      vi.clearAllMocks();
    }
  });

  afterAll(async () => {
    await resetDbPool();
  });

  async function insertFixture() {
    const db = getDb();
    const allianceId = uid("alliance");
    const commanderId = uid("cmd");
    const ashedMemberId = uid("member");
    const now = new Date();
    await db
      .insert(schema.gameSeasons)
      .values({ id: "season-1", seasonNumber: 1 })
      .onConflictDoNothing({ target: schema.gameSeasons.id });
    await db
      .insert(schema.gameServers)
      .values({ id: "server-1203", serverNumber: 1203, seasonId: "season-1" })
      .onConflictDoNothing({ target: schema.gameServers.serverNumber });
    await db.insert(schema.alliances).values({
      id: allianceId,
      slug: uid("slug"),
      tag: "SSI",
      name: "Stat Sync IT Alliance",
      operatingMode: "native",
      gameServerNumber: 1203,
      gameServerId: "server-1203",
      createdAt: now,
      updatedAt: now,
    });
    createdAllianceIds.push(allianceId);
    await db.insert(schema.commanders).values({
      id: commanderId,
      primaryName: "Stat Sync IT",
      primaryNameNormalized: "stat sync it",
      currentAllianceId: allianceId,
      createdAt: now,
      updatedAt: now,
    });
    createdCommanderIds.push(commanderId);
    return { allianceId, commanderId, ashedMemberId };
  }

  async function conflictRows(commanderId: string) {
    return getDb()
      .select()
      .from(schema.hqAshedStatSyncConflicts)
      .where(eq(schema.hqAshedStatSyncConflicts.commanderId, commanderId));
  }

  for (const statCase of cases) {
    it(`${statCase.name}: a higher HQ submit committed while inbound waits for the lock is not overwritten`, async () => {
      const { allianceId, commanderId, ashedMemberId } = await insertFixture();
      await statCase.write({
        commanderId,
        allianceId,
        ashedMemberId,
        total: statCase.baseline,
        source: "ashed_sync",
      });

      const db = getDb();
      const realTransaction = db.transaction.bind(db);

      let blockerReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        blockerReady = resolve;
      });
      let releaseBlocker!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      let blockerPidResolve!: (pid: number) => void;
      const blockerPidReady = new Promise<number>((resolve) => {
        blockerPidResolve = resolve;
      });

      // Higher web submit: takes the commander lock first and commits only
      // after the inbound sync is provably queued behind it.
      const blockerPromise = realTransaction(async (tx) => {
        const pidRows = (await tx.execute(
          sql`select pg_backend_pid() as pid`,
        )) as unknown as { pid: number }[];
        blockerPidResolve(Number(pidRows[0].pid));
        await tx
          .select({ id: schema.commanders.id })
          .from(schema.commanders)
          .where(eq(schema.commanders.id, commanderId))
          .for("update");
        blockerReady();
        await released;
        return statCase.write({
          commanderId,
          allianceId,
          ashedMemberId,
          total: statCase.higherHq,
          source: "web",
          tx,
        });
      });

      const blockerPid = await Promise.race([
        blockerPidReady,
        blockerPromise.then(() => {
          throw new Error("blocker_finished_before_pid");
        }),
      ]);
      await Promise.race([
        ready,
        blockerPromise.then(() => {
          throw new Error("blocker_finished_before_lock");
        }),
      ]);

      let inboundPidResolve!: (pid: number) => void;
      const inboundPidReady = new Promise<number>((resolve) => {
        inboundPidResolve = resolve;
      });
      const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work) =>
        realTransaction(async (tx) => {
          const pidRows = (await tx.execute(
            sql`select pg_backend_pid() as pid`,
          )) as unknown as { pid: number }[];
          inboundPidResolve(Number(pidRows[0].pid));
          return work(tx);
        }),
      );

      const inboundPromise = decideAndMaybeApplyInboundStat({
        adapter: statCase.adapter,
        commanderId,
        allianceId,
        ashedMemberId,
        memberName: "Stat Sync IT",
        ashedTotal: statCase.ashed,
      });

      let results: PromiseSettledResult<unknown>[] = [];
      try {
        const inboundPid = await Promise.race([
          inboundPidReady,
          inboundPromise.then(() => {
            throw new Error("inbound_finished_before_pid_observation");
          }),
        ]);
        await vi.waitFor(
          async () => {
            const [row] = (await db.execute(
              sql`select ${blockerPid} = any(pg_blocking_pids(${inboundPid})) as waiting`,
            )) as unknown as { waiting: boolean }[];
            expect(row.waiting).toBe(true);
          },
          { timeout: 5000, interval: 20 },
        );
      } finally {
        releaseBlocker();
        spy.mockRestore();
        results = await Promise.allSettled([blockerPromise, inboundPromise]);
      }

      expect(results[0]).toMatchObject({ status: "fulfilled", value: true });
      expect(results[1]).toMatchObject({
        status: "fulfilled",
        value: "conflict",
      });
      expect(await statCase.readCurrent(commanderId)).toBe(statCase.higherHq);

      const events = await statCase.eventTotals(commanderId);
      expect(events.map((row) => row.total).sort((a, b) => a - b)).toEqual([
        statCase.baseline,
        statCase.higherHq,
      ]);
      expect(events.some((row) => row.total === statCase.ashed)).toBe(false);

      const conflicts = await conflictRows(commanderId);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        allianceId,
        stat: statCase.adapter.stat,
        hqTotal: statCase.higherHq,
        ashedTotal: statCase.ashed,
        hqSource: "web",
      });
    });

    it(`${statCase.name}: applies a higher Ashed value when HQ has not changed`, async () => {
      const { allianceId, commanderId, ashedMemberId } = await insertFixture();
      await statCase.write({
        commanderId,
        allianceId,
        ashedMemberId,
        total: statCase.baseline,
        source: "ashed_sync",
      });

      const decision = await decideAndMaybeApplyInboundStat({
        adapter: statCase.adapter,
        commanderId,
        allianceId,
        ashedMemberId,
        memberName: "Stat Sync IT",
        ashedTotal: statCase.ashed,
      });

      expect(decision).toBe("apply");
      expect(await statCase.readCurrent(commanderId)).toBe(statCase.ashed);
      const events = await statCase.eventTotals(commanderId);
      expect(
        events
          .filter((row) => row.source === "ashed_sync")
          .map((row) => row.total)
          .sort((a, b) => a - b),
      ).toEqual([statCase.baseline, statCase.ashed]);
      expect(await conflictRows(commanderId)).toHaveLength(0);
    });
  }

  it("fails closed for a missing commander without writing", async () => {
    const { allianceId } = await insertFixture();
    const missingCommanderId = uid("missing");

    await expect(
      decideAndMaybeApplyInboundStat({
        adapter: killsStatSyncAdapter,
        commanderId: missingCommanderId,
        allianceId,
        ashedMemberId: uid("member"),
        memberName: "Stat Sync IT",
        ashedTotal: 123_000,
      }),
    ).rejects.toThrow("commander_not_found");

    const events = await getDb()
      .select({ id: schema.commanderKillsEvents.id })
      .from(schema.commanderKillsEvents)
      .where(eq(schema.commanderKillsEvents.commanderId, missingCommanderId));
    expect(events).toHaveLength(0);
    expect(await conflictRows(missingCommanderId)).toHaveLength(0);
  });
});
