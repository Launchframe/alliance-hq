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
import {
  upsertMemberSeasonVr,
  VrPendingChangedError,
  VrSubmissionChangedError,
} from "./repository";
import type { VrPendingState } from "./types";

const enabled = process.env.ACTIVITY_DB_TEST === "1";
const alertMock = vi.mocked(scheduleActivityBlockedAlert);

const ACTIVITY_NS = "commander-season-vr-events";
const SEASON_KEY = "1";
const MEMBER_ID = `vr-it-member-${randomUUID()}`;

function uid(prefix: string) {
  return `vr-it-${prefix}-${randomUUID()}`;
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

describe.skipIf(!enabled)("vr activity integration", () => {
  const createdCommanderIds: string[] = [];
  const createdMembershipIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdCommanderLinkIds: string[] = [];
  const createdDiscordLinkIds: string[] = [];
  const createdPendingKeys: { allianceId: string; hqUserId: string }[] = [];
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
          .delete(schema.commanderSeasonVrEvents)
          .where(
            inArray(schema.commanderSeasonVrEvents.commanderId, commanderIds),
          );
        await db
          .delete(schema.commanderSeasonVr)
          .where(
            inArray(schema.commanderSeasonVr.commanderId, commanderIds),
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
          .delete(schema.hqVrPending)
          .where(eq(schema.hqVrPending.hqUserId, key.hqUserId));
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
      slug: `vr-it-${randomUUID()}`,
      tag: "VIT",
      name: "VR IT Alliance",
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
    options: {
      memberId?: string;
      seasonKey?: string;
      highestBaseVr?: number;
    } = {},
  ) {
    const db = getDb();
    const memberId = options.memberId ?? MEMBER_ID;
    const commanderId = uid("cmd");
    const membershipId = uid("cam");
    const rosterId = uid("roster");
    const now = new Date();

    await db.insert(schema.commanders).values({
      id: commanderId,
      primaryName: "VR IT Commander",
      primaryNameNormalized: "vr it commander",
      currentAllianceId: allianceId,
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
      currentName: "VR IT Commander",
      status: "active",
      allianceRank: 4,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    createdMemberIds.push(rosterId);

    if (options.highestBaseVr !== undefined) {
      await db.insert(schema.commanderSeasonVr).values({
        id: uid("svr"),
        commanderId,
        seasonKey: options.seasonKey ?? SEASON_KEY,
        highestBaseVr: options.highestBaseVr,
        createdAt: now,
        updatedAt: now,
      });
    }

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
      displayName: "VR IT User",
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
      memberDisplayName: "VR IT Commander",
      gameUid: `9${randomUUID().replace(/\D/g, "1").slice(0, 14)}`,
    });
    createdDiscordLinkIds.push(linkId);
    return discordUserId;
  }

  type UpsertInput = Parameters<typeof upsertMemberSeasonVr>[0];

  function baseInput(
    commanderId: string,
    memberId: string,
    allianceId: string,
    overrides: Partial<UpsertInput> = {},
  ): UpsertInput {
    return {
      commanderId,
      ashedMemberId: memberId,
      allianceId,
      seasonKey: SEASON_KEY,
      baseVr: 3400,
      eventSource: "web",
      ...overrides,
    };
  }

  async function historyCount(commanderId: string, seasonKey = SEASON_KEY) {
    const rows = await getDb()
      .select({ id: schema.commanderSeasonVrEvents.id })
      .from(schema.commanderSeasonVrEvents)
      .where(
        and(
          eq(schema.commanderSeasonVrEvents.commanderId, commanderId),
          eq(schema.commanderSeasonVrEvents.seasonKey, seasonKey),
        ),
      );
    return rows.length;
  }

  async function activityRows(commanderId: string) {
    const history = await getDb()
      .select({ id: schema.commanderSeasonVrEvents.id })
      .from(schema.commanderSeasonVrEvents)
      .where(eq(schema.commanderSeasonVrEvents.commanderId, commanderId));
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

  async function seasonSummary(commanderId: string, seasonKey = SEASON_KEY) {
    const [row] = await getDb()
      .select()
      .from(schema.commanderSeasonVr)
      .where(
        and(
          eq(schema.commanderSeasonVr.commanderId, commanderId),
          eq(schema.commanderSeasonVr.seasonKey, seasonKey),
        ),
      );
    return row;
  }

  it("captures a verified web submission in one transaction", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3000,
    });
    const principal = await insertWebActor(allianceId, commanderId);

    const changed = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          expectedPreviousBaseVr: 3000,
        },
      }),
    );
    expect(changed).toBe(true);

    const history = await getDb()
      .select()
      .from(schema.commanderSeasonVrEvents)
      .where(eq(schema.commanderSeasonVrEvents.commanderId, commanderId));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      commanderId,
      seasonKey: SEASON_KEY,
      baseVr: 3400,
      previousBaseVr: 3000,
      source: "web",
      allianceId,
      reportedByHqUserId: principal.hqUserId,
    });

    const events = (await activityRows(commanderId)).filter(
      (row) => row.sourceKey === history[0]!.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "vr.submitted",
      actorKind: "hq",
      originalHqUserId: principal.hqUserId,
      personalOwnerHqUserId: principal.hqUserId,
      actorCommanderId: commanderId,
      channel: "web",
      method: "manual",
      allianceId,
      actorGameRank: "R4",
      payload: { value: "3400", previousValue: "3000" },
    });

    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(3400);
  });

  it("captures an unlinked discord submission without an hq owner", async () => {
    const allianceId = await insertAlliance();
    const memberId = `vr-it-member-${randomUUID()}`;
    const { commanderId } = await insertCommanderFixture(allianceId, {
      memberId,
    });
    const discordUserId = await insertDiscordActor(allianceId, memberId);

    const changed = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        eventSource: "discord",
        discordUserId,
        activity: {
          identity: { kind: "discord", discordUserId },
          expectedPreviousBaseVr: null,
        },
      }),
    );
    expect(changed).toBe(true);

    const history = await getDb()
      .select()
      .from(schema.commanderSeasonVrEvents)
      .where(eq(schema.commanderSeasonVrEvents.commanderId, commanderId));
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
      payload: { value: "3400", previousValue: null },
    });
  });

  it("records no history or activity for a no-op submission", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);

    await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web" as const, principal },
          expectedPreviousBaseVr: null,
        },
      }),
    );
    const again = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web" as const, principal },
          expectedPreviousBaseVr: 3400,
        },
      }),
    );

    expect(again).toBe(false);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(1);
  });

  it("serializes concurrent identical first-season submissions", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);
    const input = baseInput(commanderId, memberId, allianceId, {
      hqUserId: principal.hqUserId,
      activity: {
        identity: { kind: "web" as const, principal },
        expectedPreviousBaseVr: null,
      },
    });

    const results = await Promise.allSettled([
      upsertMemberSeasonVr(input),
      upsertMemberSeasonVr(input),
    ]);

    const fulfilled = results.map((result) =>
      result.status === "fulfilled" ? result.value : result,
    );
    expect(fulfilled.filter((value) => value === true)).toHaveLength(1);
    expect(fulfilled.filter((value) => value === false)).toHaveLength(1);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(1);
    const summaries = await getDb()
      .select({ id: schema.commanderSeasonVr.id })
      .from(schema.commanderSeasonVr)
      .where(
        and(
          eq(schema.commanderSeasonVr.commanderId, commanderId),
          eq(schema.commanderSeasonVr.seasonKey, SEASON_KEY),
        ),
      );
    expect(summaries).toHaveLength(1);
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
    const upsertPromise = upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          expectedPreviousBaseVr: null,
        },
      }),
    );
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
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(3400);
  });

  it("reads the locked season summary row so direct-summary writers stay visible", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3000,
    });
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
        .update(schema.commanderSeasonVr)
        .set({ highestBaseVr: 3400, updatedAt: new Date() })
        .where(
          and(
            eq(schema.commanderSeasonVr.commanderId, commanderId),
            eq(schema.commanderSeasonVr.seasonKey, SEASON_KEY),
          ),
        );
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
        throw new Error("blocker_finished_before_update");
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
    const upsertPromise = upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        baseVr: 8000,
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          expectedPreviousBaseVr: 3000,
        },
      }),
    );
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

    const history = await getDb()
      .select()
      .from(schema.commanderSeasonVrEvents)
      .where(eq(schema.commanderSeasonVrEvents.commanderId, commanderId));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ baseVr: 8000, previousBaseVr: 3400 });

    const events = (await activityRows(commanderId)).filter(
      (row) => row.sourceKey === history[0]!.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      value: "8000",
      previousValue: "3400",
    });
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(8000);
  });

  it("rolls back summary, history, and pending consumption when the activity write fails", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3000,
    });
    const principal = await insertWebActor(allianceId, commanderId);

    const expected: VrPendingState = {
      kind: "anomaly_confirm",
      proposedVr: 3400,
      ashedMemberId: memberId,
      commanderId,
      seasonKey: SEASON_KEY,
    };
    await getDb().insert(schema.hqVrPending).values({
      allianceId,
      hqUserId: principal.hqUserId,
      pendingJson: expected as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      updatedAt: new Date(),
    });
    createdPendingKeys.push({ allianceId, hqUserId: principal.hqUserId });

    const db = getDb();
    const realTransaction = db.transaction.bind(db);
    const functionName = `vr_fail_${randomUUID().replaceAll("-", "_")}`;
    const triggerName = `vr_fail_${randomUUID().replaceAll("-", "_")}`;
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work) =>
      realTransaction(async (tx) => {
        await tx.execute(
          sql`CREATE FUNCTION ${sql.identifier(functionName)}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'vr_activity_test_blocked'; END; $$`,
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
        await upsertMemberSeasonVr(
          baseInput(commanderId, memberId, allianceId, {
            hqUserId: principal.hqUserId,
            activity: {
              identity: { kind: "web", principal },
              expectedPreviousBaseVr: 3000,
              pending: { expected, required: true },
            },
          }),
        );
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
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(3000);
    const pendingRows = await getDb()
      .select()
      .from(schema.hqVrPending)
      .where(eq(schema.hqVrPending.hqUserId, principal.hqUserId));
    expect(pendingRows).toHaveLength(1);
  });

  it("consumes a matching pending row on a successful confirmation", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3000,
    });
    const principal = await insertWebActor(allianceId, commanderId);

    const expected: VrPendingState = {
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: memberId,
      commanderId,
      seasonKey: SEASON_KEY,
    };
    await getDb().insert(schema.hqVrPending).values({
      allianceId,
      hqUserId: principal.hqUserId,
      pendingJson: expected as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      updatedAt: new Date(),
    });
    createdPendingKeys.push({ allianceId, hqUserId: principal.hqUserId });

    const changed = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        baseVr: 8000,
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          expectedPreviousBaseVr: 3000,
          pending: { expected, required: true },
        },
      }),
    );
    expect(changed).toBe(true);

    const pendingRows = await getDb()
      .select()
      .from(schema.hqVrPending)
      .where(eq(schema.hqVrPending.hqUserId, principal.hqUserId));
    expect(pendingRows).toHaveLength(0);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(1);
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(8000);
  });

  it("does not consume stale, expired, foreign, or wrong-season pending rows", async () => {
    const allianceId = await insertAlliance();
    const otherAllianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3000,
    });
    const principal = await insertWebActor(allianceId, commanderId);

    const expected: VrPendingState = {
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: memberId,
      commanderId,
      seasonKey: SEASON_KEY,
    };

    await getDb().insert(schema.hqVrPending).values({
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
      upsertMemberSeasonVr(
        baseInput(commanderId, memberId, allianceId, {
          baseVr: 8000,
          hqUserId: principal.hqUserId,
          activity: {
            identity: { kind: "web", principal },
            expectedPreviousBaseVr: 3000,
            pending: { expected, required: true },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(VrPendingChangedError);
    expect(alertMock).not.toHaveBeenCalled();

    await getDb().insert(schema.hqVrPending).values({
      allianceId,
      hqUserId: principal.hqUserId,
      pendingJson: expected as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() - 1000),
      updatedAt: new Date(),
    });
    createdPendingKeys.push({ allianceId, hqUserId: principal.hqUserId });

    await expect(
      upsertMemberSeasonVr(
        baseInput(commanderId, memberId, allianceId, {
          baseVr: 8000,
          hqUserId: principal.hqUserId,
          activity: {
            identity: { kind: "web", principal },
            expectedPreviousBaseVr: 3000,
            pending: { expected, required: true },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(VrPendingChangedError);

    await expect(
      upsertMemberSeasonVr(
        baseInput(commanderId, memberId, allianceId, {
          baseVr: 8000,
          hqUserId: principal.hqUserId,
          activity: {
            identity: { kind: "web", principal },
            expectedPreviousBaseVr: 3000,
            pending: {
              expected: { ...expected, seasonKey: "2" },
              required: true,
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(VrPendingChangedError);

    const stillPending = await getDb()
      .select()
      .from(schema.hqVrPending)
      .where(eq(schema.hqVrPending.hqUserId, principal.hqUserId));
    expect(stillPending).toHaveLength(2);
    expect(await historyCount(commanderId)).toBe(0);
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(3000);
  });

  it("consumes an obsolete optional pending and preserves a mismatched newer prompt", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3000,
    });
    const principal = await insertWebActor(allianceId, commanderId);
    const pendingRows = () =>
      getDb()
        .select()
        .from(schema.hqVrPending)
        .where(eq(schema.hqVrPending.hqUserId, principal.hqUserId));

    const obsolete: VrPendingState = {
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: memberId,
      commanderId,
      seasonKey: "2",
    };
    await getDb().insert(schema.hqVrPending).values({
      allianceId,
      hqUserId: principal.hqUserId,
      pendingJson: obsolete as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      updatedAt: new Date(),
    });
    createdPendingKeys.push({ allianceId, hqUserId: principal.hqUserId });

    const fresh = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          expectedPreviousBaseVr: 3000,
          pending: { expected: obsolete, required: false },
        },
      }),
    );
    expect(fresh).toBe(true);
    expect(await pendingRows()).toHaveLength(0);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      value: "3400",
      previousValue: "3000",
    });

    const newer: VrPendingState = {
      kind: "anomaly_confirm",
      proposedVr: 8500,
      ashedMemberId: memberId,
      commanderId,
      seasonKey: SEASON_KEY,
    };
    await getDb().insert(schema.hqVrPending).values({
      allianceId,
      hqUserId: principal.hqUserId,
      pendingJson: newer as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      updatedAt: new Date(),
    });

    const explicit = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        baseVr: 3800,
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          expectedPreviousBaseVr: 3400,
          pending: { expected: obsolete, required: false },
        },
      }),
    );
    expect(explicit).toBe(true);
    expect(await pendingRows()).toHaveLength(1);
    expect(await historyCount(commanderId)).toBe(2);
    const afterEvents = await activityRows(commanderId);
    expect(afterEvents).toHaveLength(2);
  });

  it("applies a one-step correction and rejects stale or excessive lower writes", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3400,
    });
    const principal = await insertWebActor(allianceId, commanderId);
    const activity = {
      identity: { kind: "web" as const, principal },
    };

    const corrected = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        baseVr: 3000,
        hqUserId: principal.hqUserId,
        activity: { ...activity, expectedPreviousBaseVr: 3400 },
      }),
    );
    expect(corrected).toBe(true);
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(3000);
    expect(await historyCount(commanderId)).toBe(1);
    expect(await activityRows(commanderId)).toHaveLength(1);

    await expect(
      upsertMemberSeasonVr(
        baseInput(commanderId, memberId, allianceId, {
          baseVr: 2750,
          hqUserId: principal.hqUserId,
          activity: { ...activity, expectedPreviousBaseVr: 2500 },
        }),
      ),
    ).rejects.toBeInstanceOf(VrSubmissionChangedError);

    await expect(
      upsertMemberSeasonVr(
        baseInput(commanderId, memberId, allianceId, {
          baseVr: 2500,
          hqUserId: principal.hqUserId,
          activity: { ...activity, expectedPreviousBaseVr: 3000 },
        }),
      ),
    ).rejects.toBeInstanceOf(VrSubmissionChangedError);

    expect(await historyCount(commanderId)).toBe(1);
    expect(await activityRows(commanderId)).toHaveLength(1);
    const finalSummary = await seasonSummary(commanderId);
    expect(finalSummary?.highestBaseVr).toBe(3000);
  });

  it("leaves other season rows untouched", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      seasonKey: "2",
      highestBaseVr: 3400,
    });
    const principal = await insertWebActor(allianceId, commanderId);

    const changed = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        hqUserId: principal.hqUserId,
        activity: {
          identity: { kind: "web", principal },
          expectedPreviousBaseVr: null,
        },
      }),
    );
    expect(changed).toBe(true);

    const other = await seasonSummary(commanderId, "2");
    expect(other?.highestBaseVr).toBe(3400);
    expect(await historyCount(commanderId, "2")).toBe(0);
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(3400);
  });

  it("writes no activity row for unattributed backfill callers", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      highestBaseVr: 3000,
    });

    const changed = await upsertMemberSeasonVr(
      baseInput(commanderId, memberId, allianceId, {
        eventSource: "backfill",
      }),
    );

    expect(changed).toBe(true);
    expect(await historyCount(commanderId)).toBe(1);
    const events = await activityRows(commanderId);
    expect(events).toHaveLength(0);
    const summary = await seasonSummary(commanderId);
    expect(summary?.highestBaseVr).toBe(3400);
  });
});
