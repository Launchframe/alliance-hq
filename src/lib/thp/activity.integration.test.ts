import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
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
import type { ActivityPrincipal } from "../activity/access.server";
import { ActivityWriteError } from "../activity/errors.server";
import { scheduleActivityBlockedAlert } from "../activity/monitoring.server";
import { ThpPendingChangedError, upsertCommanderThp } from "./repository";
import type { ThpPendingState } from "./types";

const enabled = process.env.ACTIVITY_DB_TEST === "1";
const alertMock = vi.mocked(scheduleActivityBlockedAlert);

const ACTIVITY_NS = "commander-thp-events";
const MEMBER_ID = `thp-it-member-${randomUUID()}`;

function uid(prefix: string) {
  return `thp-it-${prefix}-${randomUUID()}`;
}

function principalFor(input: {
  hqUserId: string;
  sessionId: string;
  allianceId: string;
}): ActivityPrincipal {
  return {
    hqUserId: input.hqUserId,
    sessionId: input.sessionId,
    currentAllianceId: input.allianceId,
    permissions: new Set(["members:read"]),
    isPlatformMaintainer: false,
    scopeFence: "",
  };
}

describe.skipIf(!enabled)("thp activity integration", () => {
  const createdCommanderIds: string[] = [];
  const createdMembershipIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdCommanderLinkIds: string[] = [];
  const createdDiscordLinkIds: string[] = [];
  const createdPendingKeys: { allianceId: string; hqUserId: string }[] = [];
  const createdBotPendingIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdUserIds: string[] = [];
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
      throw new Error("Activity integration requires one guarded database.");
    }
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        throw new Error("Activity integration requires one guarded database.");
      }
      assertE2eDatabaseUrl(url);
    }
    guarded = true;
  });

  afterEach(async () => {
    if (!guarded) return;
    try {
      const db = getDb();
      const commanderIds = [...createdCommanderIds];
      if (commanderIds.length > 0) {
        await db
          .delete(schema.activityEvents)
          .where(
            and(
              eq(schema.activityEvents.sourceNamespace, ACTIVITY_NS),
              inArray(schema.activityEvents.actorCommanderId, commanderIds),
            ),
          );
        await db
          .delete(schema.commanderThpEvents)
          .where(
            inArray(schema.commanderThpEvents.commanderId, commanderIds),
          );
      }
      for (const id of createdCommanderLinkIds.splice(0)) {
        await db
          .delete(schema.hqUserCommanders)
          .where(eq(schema.hqUserCommanders.id, id));
      }
      for (const id of createdDiscordLinkIds.splice(0)) {
        await db
          .delete(schema.discordMemberLinks)
          .where(eq(schema.discordMemberLinks.id, id));
      }
      for (const key of createdPendingKeys.splice(0)) {
        await db
          .delete(schema.hqThpPending)
          .where(eq(schema.hqThpPending.hqUserId, key.hqUserId));
      }
      for (const id of createdBotPendingIds.splice(0)) {
        await db
          .delete(schema.discordBotPending)
          .where(eq(schema.discordBotPending.discordUserId, id));
      }
      for (const id of createdMemberIds.splice(0)) {
        await db
          .delete(schema.allianceMembers)
          .where(eq(schema.allianceMembers.id, id));
      }
      for (const id of createdMembershipIds.splice(0)) {
        await db
          .delete(schema.commanderAllianceMemberships)
          .where(eq(schema.commanderAllianceMemberships.id, id));
      }
      for (const id of createdCommanderIds.splice(0)) {
        await db
          .delete(schema.commanders)
          .where(eq(schema.commanders.id, id));
      }
      for (const id of createdSessionIds.splice(0)) {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
      }
      for (const id of createdUserIds.splice(0)) {
        await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, id));
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

  async function insertAlliance() {
    const db = getDb();
    const allianceId = uid("alliance");
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
      slug: `thp-it-${randomUUID()}`,
      tag: "TIT",
      name: "THP IT Alliance",
      operatingMode: "native",
      gameServerNumber: 1203,
      gameServerId: "server-1203",
      createdAt: now,
      updatedAt: now,
    });
    createdAllianceIds.push(allianceId);
    return allianceId;
  }

  async function insertCommanderFixture(
    allianceId: string,
    options: { memberId?: string; total?: number | null } = {},
  ) {
    const db = getDb();
    const memberId = options.memberId ?? MEMBER_ID;
    const commanderId = uid("cmd");
    const membershipId = uid("cam");
    const rosterId = uid("roster");
    const now = new Date();

    await db.insert(schema.commanders).values({
      id: commanderId,
      primaryName: "THP IT Commander",
      primaryNameNormalized: "thp it commander",
      currentAllianceId: allianceId,
      currentTotalHeroPower:
        "total" in options ? options.total : 100_000_000,
      createdAt: now,
      updatedAt: now,
    });
    createdCommanderIds.push(commanderId);

    await db.insert(schema.commanderAllianceMemberships).values({
      id: membershipId,
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    createdMembershipIds.push(membershipId);

    await db.insert(schema.allianceMembers).values({
      id: rosterId,
      allianceId,
      ashedMemberId: memberId,
      ashedAllianceId: `native-roster:${allianceId}`,
      currentName: "THP IT Commander",
      status: "active",
      allianceRank: 4,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    createdMemberIds.push(rosterId);

    return { commanderId, memberId };
  }

  async function insertWebActor(allianceId: string, commanderId: string) {
    const db = getDb();
    const hqUserId = uid("hq");
    const sessionId = uid("sess");
    const linkId = uid("huc");

    await db.insert(schema.hqUsers).values({
      id: hqUserId,
      email: `${hqUserId}@e2e.test`,
      displayName: "THP IT User",
    });
    createdUserIds.push(hqUserId);
    await db.insert(schema.sessions).values({
      id: sessionId,
      hqUserId,
      currentAllianceId: allianceId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    createdSessionIds.push(sessionId);
    await db.insert(schema.hqUserCommanders).values({
      id: linkId,
      hqUserId,
      commanderId,
      isPrimary: true,
    });
    createdCommanderLinkIds.push(linkId);

    return principalFor({ hqUserId, sessionId, allianceId });
  }

  async function insertDiscordActor(allianceId: string, memberId: string) {
    const db = getDb();
    const discordUserId = uid("discord");
    const linkId = uid("dlink");
    await db.insert(schema.discordMemberLinks).values({
      id: linkId,
      allianceId,
      discordUserId,
      ashedMemberId: memberId,
      memberDisplayName: "THP IT Commander",
      gameUid: `9${randomUUID().replace(/\D/g, "1").slice(0, 14)}`,
    });
    createdDiscordLinkIds.push(linkId);
    return discordUserId;
  }

  async function historyCount(commanderId: string) {
    const rows = await getDb()
      .select({ id: schema.commanderThpEvents.id })
      .from(schema.commanderThpEvents)
      .where(eq(schema.commanderThpEvents.commanderId, commanderId));
    return rows.length;
  }

  async function activityRows(commanderId: string) {
    const history = await getDb()
      .select({ id: schema.commanderThpEvents.id })
      .from(schema.commanderThpEvents)
      .where(eq(schema.commanderThpEvents.commanderId, commanderId));
    if (history.length === 0) return [];
    return getDb()
      .select()
      .from(schema.activityEvents)
      .where(
        sql`${schema.activityEvents.sourceNamespace} = ${ACTIVITY_NS}
          and ${schema.activityEvents.sourceKey} in (${sql.join(
            history.map((row) => sql`${row.id}`),
            sql`, `,
          )})`,
      );
  }

  it("captures a verified web submission in one transaction", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);

    const changed = await upsertCommanderThp({
      commanderId,
      total: 125_000_000,
      allianceId,
      ashedMemberId: memberId,
      memberName: "THP IT Commander",
      source: "web",
      hqUserId: principal.hqUserId,
      activity: {
        identity: { kind: "web", principal },
        method: "manual",
      },
    });
    expect(changed).toBe(true);

    const history = await getDb()
      .select()
      .from(schema.commanderThpEvents)
      .where(eq(schema.commanderThpEvents.commanderId, commanderId));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      commanderId,
      total: 125_000_000,
      previousTotal: 100_000_000,
      source: "web",
      allianceId,
      reportedByHqUserId: principal.hqUserId,
    });

    const events = (await activityRows(commanderId)).filter((row) =>
      row.sourceKey === history[0]!.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "thp.submitted",
      actorKind: "hq",
      originalHqUserId: principal.hqUserId,
      personalOwnerHqUserId: principal.hqUserId,
      actorCommanderId: commanderId,
      channel: "web",
      method: "manual",
      allianceId,
      actorGameRank: "R4",
      payload: { value: "125000000", previousValue: "100000000" },
    });

    const [commander] = await getDb()
      .select({ total: schema.commanders.currentTotalHeroPower })
      .from(schema.commanders)
      .where(eq(schema.commanders.id, commanderId));
    expect(commander?.total).toBe(125_000_000);
  });

  it("captures an unlinked discord submission without an hq owner", async () => {
    const allianceId = await insertAlliance();
    const memberId = `thp-it-member-${randomUUID()}`;
    const { commanderId } = await insertCommanderFixture(allianceId, {
      memberId,
      total: null,
    });
    const discordUserId = await insertDiscordActor(allianceId, memberId);

    const changed = await upsertCommanderThp({
      commanderId,
      total: 88_000_000,
      allianceId,
      ashedMemberId: memberId,
      memberName: "THP IT Commander",
      source: "discord",
      discordUserId,
      activity: {
        identity: { kind: "discord", discordUserId },
        method: "manual",
      },
    });
    expect(changed).toBe(true);

    const history = await getDb()
      .select()
      .from(schema.commanderThpEvents)
      .where(eq(schema.commanderThpEvents.commanderId, commanderId));
    expect(history).toHaveLength(1);

    const events = (await activityRows(commanderId)).filter(
      (row) => row.sourceKey === history[0]!.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorKind: "discord",
      originalHqUserId: null,
      personalOwnerHqUserId: null,
      originalDiscordUserId: discordUserId,
      actorCommanderId: commanderId,
      channel: "discord",
      payload: { value: "88000000", previousValue: null },
    });
  });

  it("records no history or activity for a no-op submission", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);
    const activity = {
      identity: { kind: "web" as const, principal },
      method: "manual" as const,
    };

    await upsertCommanderThp({
      commanderId,
      total: 140_000_000,
      allianceId,
      ashedMemberId: memberId,
      source: "web",
      hqUserId: principal.hqUserId,
      activity,
    });
    const again = await upsertCommanderThp({
      commanderId,
      total: 140_000_000,
      allianceId,
      ashedMemberId: memberId,
      source: "web",
      hqUserId: principal.hqUserId,
      activity,
    });

    expect(again).toBe(false);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(1);
  });

  it("serializes concurrent identical submissions", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);
    const input = {
      commanderId,
      total: 150_000_000,
      allianceId,
      ashedMemberId: memberId,
      source: "web" as const,
      hqUserId: principal.hqUserId,
      activity: {
        identity: { kind: "web" as const, principal },
        method: "manual" as const,
      },
    };

    const results = await Promise.allSettled([
      upsertCommanderThp(input),
      upsertCommanderThp(input),
    ]);

    const fulfilled = results.map((result) =>
      result.status === "fulfilled" ? result.value : result,
    );
    expect(fulfilled.filter((value) => value === true)).toHaveLength(1);
    expect(fulfilled.filter((value) => value === false)).toHaveLength(1);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(1);
  });

  it("blocks a submission on the commander row lock while another transaction holds it", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);
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

    let writerPidResolve!: (pid: number) => void;
    const writerPidReady = new Promise<number>((resolve) => {
      writerPidResolve = resolve;
    });
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work) =>
      realTransaction(async (tx) => {
        const pidRows = (await tx.execute(
          sql`select pg_backend_pid() as pid`,
        )) as unknown as { pid: number }[];
        writerPidResolve(Number(pidRows[0].pid));
        return work(tx);
      }),
    );

    let results: PromiseSettledResult<unknown>[] = [];
    const upsertPromise = upsertCommanderThp({
      commanderId,
      total: 150_000_000,
      allianceId,
      ashedMemberId: memberId,
      source: "web",
      hqUserId: principal.hqUserId,
      activity: {
        identity: { kind: "web", principal },
        method: "manual",
      },
    });
    try {
      const writerPid = await Promise.race([
        writerPidReady,
        upsertPromise.then(() => {
          throw new Error("upsert_finished_before_pid_observation");
        }),
      ]);
      await vi.waitFor(
        async () => {
          const [row] = (await db.execute(
            sql`select ${blockerPid} = any(pg_blocking_pids(${writerPid})) as waiting`,
          )) as unknown as { waiting: boolean }[];
          expect(row.waiting).toBe(true);
        },
        { timeout: 5000, interval: 20 },
      );
    } finally {
      releaseBlocker();
      spy.mockRestore();
      results = await Promise.allSettled([blockerPromise, upsertPromise]);
    }

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "fulfilled", value: true });
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(1);
    const [commander] = await db
      .select({ total: schema.commanders.currentTotalHeroPower })
      .from(schema.commanders)
      .where(eq(schema.commanders.id, commanderId));
    expect(commander?.total).toBe(150_000_000);
  });

  it("rolls back history, current, and pending consumption when the activity write fails", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);

    const expected: ThpPendingState = {
      kind: "anomaly_confirm",
      proposedTotal: 160_000_000,
      proposedBreakdown: null,
      commanderId,
    };
    await getDb().insert(schema.hqThpPending).values({
      allianceId,
      hqUserId: principal.hqUserId,
      pendingJson: expected as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      updatedAt: new Date(),
    });
    createdPendingKeys.push({ allianceId, hqUserId: principal.hqUserId });

    const db = getDb();
    const realTransaction = db.transaction.bind(db);
    const functionName = `thp_fail_${randomUUID().replaceAll("-", "_")}`;
    const triggerName = `thp_fail_${randomUUID().replaceAll("-", "_")}`;
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work) =>
      realTransaction(async (tx) => {
        await tx.execute(
          sql`CREATE FUNCTION ${sql.identifier(functionName)}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'thp_activity_test_blocked'; END; $$`,
        );
        await tx.execute(
          sql`CREATE TRIGGER ${sql.identifier(triggerName)} BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION ${sql.identifier(functionName)}()`,
        );
        return work(tx);
      }),
    );

    try {
      let caught: unknown;
      try {
        await upsertCommanderThp({
          commanderId,
          total: 160_000_000,
          allianceId,
          ashedMemberId: memberId,
          source: "web",
          hqUserId: principal.hqUserId,
          activity: {
            identity: { kind: "web", principal },
            method: "manual",
            pending: { expected, required: true },
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ActivityWriteError);
      expect((caught as ActivityWriteError).sqlState).toBe("P0001");
      expect(alertMock).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }

    expect(await historyCount(commanderId)).toBe(0);
    const [commander] = await getDb()
      .select({ total: schema.commanders.currentTotalHeroPower })
      .from(schema.commanders)
      .where(eq(schema.commanders.id, commanderId));
    expect(commander?.total).toBe(100_000_000);
    const pendingRows = await getDb()
      .select()
      .from(schema.hqThpPending)
      .where(eq(schema.hqThpPending.hqUserId, principal.hqUserId));
    expect(pendingRows).toHaveLength(1);
  });

  it("does not consume stale, expired, or foreign pending rows", async () => {
    const allianceId = await insertAlliance();
    const otherAllianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);

    const expected: ThpPendingState = {
      kind: "anomaly_confirm",
      proposedTotal: 170_000_000,
      proposedBreakdown: null,
      commanderId,
    };
    const different: ThpPendingState = {
      kind: "anomaly_confirm",
      proposedTotal: 171_000_000,
      proposedBreakdown: null,
      commanderId,
    };

    await getDb().insert(schema.hqThpPending).values({
      allianceId: otherAllianceId,
      hqUserId: principal.hqUserId,
      pendingJson: expected as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      updatedAt: new Date(),
    });
    createdPendingKeys.push({
      allianceId: otherAllianceId,
      hqUserId: principal.hqUserId,
    });

    await expect(
      upsertCommanderThp({
        commanderId,
        total: 170_000_000,
        allianceId,
        ashedMemberId: memberId,
        source: "web",
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          method: "manual",
          pending: { expected, required: true },
        },
      }),
    ).rejects.toBeInstanceOf(ThpPendingChangedError);
    expect(alertMock).not.toHaveBeenCalled();

    await getDb().insert(schema.hqThpPending).values({
      allianceId,
      hqUserId: principal.hqUserId,
      pendingJson: expected as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() - 1000),
      updatedAt: new Date(),
    });
    createdPendingKeys.push({ allianceId, hqUserId: principal.hqUserId });

    await expect(
      upsertCommanderThp({
        commanderId,
        total: 170_000_000,
        allianceId,
        ashedMemberId: memberId,
        source: "web",
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          method: "manual",
          pending: { expected, required: true },
        },
      }),
    ).rejects.toBeInstanceOf(ThpPendingChangedError);

    const stillPending = await getDb()
      .select()
      .from(schema.hqThpPending)
      .where(eq(schema.hqThpPending.hqUserId, principal.hqUserId));
    expect(stillPending).toHaveLength(2);

    await getDb()
      .update(schema.hqThpPending)
      .set({ expiresAt: new Date(Date.now() + 10 * 60 * 1000) })
      .where(eq(schema.hqThpPending.allianceId, allianceId));

    await expect(
      upsertCommanderThp({
        commanderId,
        total: 170_000_000,
        allianceId,
        ashedMemberId: memberId,
        source: "web",
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          method: "manual",
          pending: { expected: different, required: true },
        },
      }),
    ).rejects.toBeInstanceOf(ThpPendingChangedError);
    expect(await historyCount(commanderId)).toBe(0);
  });

  it("writes no activity row for background sync sources", async () => {
    const allianceId = await insertAlliance();
    const { commanderId } = await insertCommanderFixture(allianceId);

    const changed = await upsertCommanderThp({
      commanderId,
      total: 200_000_000,
      allianceId,
      source: "ashed_sync",
    });

    expect(changed).toBe(true);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(0);
  });
});
