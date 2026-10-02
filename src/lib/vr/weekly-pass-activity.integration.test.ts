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
  getDiscordBotPending,
  setWeeklyPass,
  WeeklyPassPendingChangedError,
  WeeklyPassTargetChangedError,
  type WeeklyPassPending,
} from "./repository";

const enabled = process.env.ACTIVITY_DB_TEST === "1";
const alertMock = vi.mocked(scheduleActivityBlockedAlert);

const ACTIVITY_NS = "commander-weekly-pass";

function uid(prefix: string) {
  return `wp-it-${prefix}-${randomUUID()}`;
}

function principalFor(input: {
  hqUserId: string;
  sessionId: string;
  allianceId: string;
  permissions?: string[];
}): ActivityPrincipal {
  return {
    hqUserId: input.hqUserId,
    sessionId: input.sessionId,
    currentAllianceId: input.allianceId,
    permissions: new Set(input.permissions ?? ["members:read"]),
    isPlatformMaintainer: false,
    scopeFence: "",
  };
}

describe.skipIf(!enabled)("weekly pass activity integration", () => {
  const createdCommanderIds: string[] = [];
  const createdMembershipIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdCommanderLinkIds: string[] = [];
  const createdDiscordLinkIds: string[] = [];
  const createdPendingUserIds: string[] = [];
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
      const allianceIds = [...createdAllianceIds];
      if (allianceIds.length > 0) {
        await db
          .delete(schema.activityEvents)
          .where(
            and(
              eq(schema.activityEvents.sourceNamespace, ACTIVITY_NS),
              inArray(schema.activityEvents.allianceId, allianceIds),
            ),
          );
      }
      for (const id of createdPendingUserIds.splice(0)) {
        await db
          .delete(schema.discordBotPending)
          .where(eq(schema.discordBotPending.discordUserId, id));
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
      slug: `wp-it-${randomUUID()}`,
      tag: "WPI",
      name: "WP IT Alliance",
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
      weeklyPassActive?: boolean;
      weeklyPassSource?: "self" | "officer" | null;
      weeklyPassUpdatedAt?: Date | null;
    } = {},
  ) {
    const db = getDb();
    const memberId = options.memberId ?? uid("member");
    const commanderId = uid("cmd");
    const membershipId = uid("cam");
    const rosterId = uid("roster");
    const now = new Date();

    await db.insert(schema.commanders).values({
      id: commanderId,
      primaryName: "WP IT Commander",
      primaryNameNormalized: "wp it commander",
      currentAllianceId: allianceId,
      weeklyPassActive: options.weeklyPassActive ?? false,
      weeklyPassSource: options.weeklyPassSource ?? null,
      weeklyPassUpdatedAt: options.weeklyPassUpdatedAt ?? null,
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
      currentName: "WP IT Commander",
      status: "active",
      allianceRank: 4,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    createdMemberIds.push(rosterId);

    return { commanderId, memberId };
  }

  async function insertWebActor(
    allianceId: string,
    commanderId: string,
    permissions: string[] = ["members:read"],
  ) {
    const db = getDb();
    const hqUserId = uid("hq");
    const sessionId = uid("sess");
    const linkId = uid("huc");

    await db.insert(schema.hqUsers).values({
      id: hqUserId,
      email: `${hqUserId}@e2e.test`,
      displayName: "WP IT User",
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

    return principalFor({ hqUserId, sessionId, allianceId, permissions });
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
      memberDisplayName: "WP IT Commander",
      gameUid: `9${randomUUID().replace(/\D/g, "1").slice(0, 14)}`,
    });
    createdDiscordLinkIds.push(linkId);
    return { discordUserId, linkId };
  }

  async function seedDiscordPending(
    input: {
      discordUserId: string;
      allianceId: string;
      pending: WeeklyPassPending | Record<string, unknown>;
      expiresInMs?: number;
    },
  ) {
    await getDb()
      .insert(schema.discordBotPending)
      .values({
        discordUserId: input.discordUserId,
        allianceId: input.allianceId,
        pendingJson: input.pending as Record<string, unknown>,
        expiresAt: new Date(Date.now() + (input.expiresInMs ?? 10 * 60 * 1000)),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.discordBotPending.discordUserId,
        set: {
          allianceId: input.allianceId,
          pendingJson: input.pending as Record<string, unknown>,
          expiresAt: new Date(
            Date.now() + (input.expiresInMs ?? 10 * 60 * 1000),
          ),
          updatedAt: new Date(),
        },
      });
    if (!createdPendingUserIds.includes(input.discordUserId)) {
      createdPendingUserIds.push(input.discordUserId);
    }
  }

  type WriteInput = Parameters<typeof setWeeklyPass>[0];

  function selfInput(
    commanderId: string,
    memberId: string,
    allianceId: string,
    principal: ActivityPrincipal,
    overrides: Partial<WriteInput> = {},
  ): WriteInput {
    return {
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: true,
      source: "self",
      activity: { identity: { kind: "web", principal } },
      ...overrides,
    };
  }

  async function commanderRow(commanderId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.commanders)
      .where(eq(schema.commanders.id, commanderId));
    return row;
  }

  async function activityRows(allianceId: string) {
    return getDb()
      .select()
      .from(schema.activityEvents)
      .where(
        and(
          eq(schema.activityEvents.sourceNamespace, ACTIVITY_NS),
          eq(schema.activityEvents.allianceId, allianceId),
        ),
      );
  }

  async function pendingRow(discordUserId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.discordBotPending)
      .where(eq(schema.discordBotPending.discordUserId, discordUserId));
    return row;
  }

  it("writes the commander change and self web event in one transaction", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);

    const changed = await setWeeklyPass(
      selfInput(commanderId, memberId, allianceId, principal),
    );
    expect(changed).toBe(true);

    const commander = await commanderRow(commanderId);
    expect(commander).toMatchObject({
      weeklyPassActive: true,
      weeklyPassSource: "self",
    });
    expect(commander?.weeklyPassUpdatedAt).toBeInstanceOf(Date);

    const events = await activityRows(allianceId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "member.weekly_pass_updated",
      actorKind: "hq",
      originalHqUserId: principal.hqUserId,
      personalOwnerHqUserId: principal.hqUserId,
      actorCommanderId: commanderId,
      channel: "web",
      method: "manual",
      allianceId,
      payload: {},
    });
  });

  it("attributes an officer write to the officer, not the target", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const officerFixture = await insertCommanderFixture(allianceId);
    const officer = await insertWebActor(
      allianceId,
      officerFixture.commanderId,
      ["members:write"],
    );

    const changed = await setWeeklyPass({
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: true,
      source: "officer",
      activity: { identity: { kind: "web", principal: officer } },
    });
    expect(changed).toBe(true);

    const commander = await commanderRow(commanderId);
    expect(commander?.weeklyPassSource).toBe("officer");

    const events = await activityRows(allianceId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      originalHqUserId: officer.hqUserId,
      actorCommanderId: officerFixture.commanderId,
      channel: "web",
    });
  });

  it("records an unlinked discord actor without an hq owner", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const { discordUserId } = await insertDiscordActor(allianceId, memberId);

    const changed = await setWeeklyPass({
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: true,
      source: "self",
      activity: { identity: { kind: "discord", discordUserId } },
    });
    expect(changed).toBe(true);

    const events = await activityRows(allianceId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorKind: "discord",
      originalHqUserId: null,
      originalDiscordUserId: discordUserId,
      actorCommanderId: commanderId,
      channel: "discord",
    });
  });

  it("emits exactly one event for identical concurrent writes", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);
    const input = selfInput(commanderId, memberId, allianceId, principal);

    const results = await Promise.allSettled([
      setWeeklyPass(input),
      setWeeklyPass(input),
    ]);

    const values = results.map((result) =>
      result.status === "fulfilled" ? result.value : result,
    );
    expect(values.filter((value) => value === true)).toHaveLength(1);
    expect(values.filter((value) => value === false)).toHaveLength(1);
    expect(await activityRows(allianceId)).toHaveLength(1);
  });

  it("records a source transition even when the boolean is unchanged", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      weeklyPassActive: true,
      weeklyPassSource: "self",
    });
    const officer = await insertWebActor(allianceId, commanderId, [
      "members:write",
    ]);

    const changed = await setWeeklyPass({
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: true,
      source: "officer",
      activity: { identity: { kind: "web", principal: officer } },
    });
    expect(changed).toBe(true);
    expect(await activityRows(allianceId)).toHaveLength(1);
    const commander = await commanderRow(commanderId);
    expect(commander?.weeklyPassSource).toBe("officer");
  });

  it("leaves the row and feed untouched on a matching no-op", async () => {
    const allianceId = await insertAlliance();
    const stampedAt = new Date("2026-01-01T00:00:00.000Z");
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      weeklyPassActive: true,
      weeklyPassSource: "self",
      weeklyPassUpdatedAt: stampedAt,
    });
    const principal = await insertWebActor(allianceId, commanderId);
    const before = await commanderRow(commanderId);

    const changed = await setWeeklyPass(
      selfInput(commanderId, memberId, allianceId, principal),
    );
    expect(changed).toBe(false);

    const after = await commanderRow(commanderId);
    expect(after?.weeklyPassUpdatedAt?.getTime()).toBe(
      before?.weeklyPassUpdatedAt?.getTime(),
    );
    expect(after?.updatedAt?.getTime()).toBe(before?.updatedAt?.getTime());
    expect(await activityRows(allianceId)).toHaveLength(0);
  });

  it("rolls back the commander change and pending consumption when the event insert fails", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const { discordUserId, linkId } = await insertDiscordActor(
      allianceId,
      memberId,
    );
    const expected: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: [linkId],
      active: true,
    };
    await seedDiscordPending({
      discordUserId,
      allianceId,
      pending: expected,
    });

    const db = getDb();
    const realTransaction = db.transaction.bind(db);
    const functionName = `wp_fail_${randomUUID().replaceAll("-", "_")}`;
    const triggerName = `wp_fail_${randomUUID().replaceAll("-", "_")}`;
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work) =>
      realTransaction(async (tx) => {
        await tx.execute(
          sql`CREATE FUNCTION ${sql.identifier(functionName)}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'wp_activity_test_blocked'; END; $$`,
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
        await setWeeklyPass({
          commanderId,
          allianceId,
          ashedMemberId: memberId,
          active: true,
          source: "self",
          activity: {
            identity: { kind: "discord", discordUserId },
            pending: { expected, required: true, linkId },
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

    const commander = await commanderRow(commanderId);
    expect(commander?.weeklyPassActive).toBe(false);
    expect(await pendingRow(discordUserId)).toBeTruthy();
    expect(await activityRows(allianceId)).toHaveLength(0);
  });

  it("waits on the commander row lock held by another transaction", async () => {
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
    const writePromise = setWeeklyPass(
      selfInput(commanderId, memberId, allianceId, principal),
    );
    try {
      const writerPid = await Promise.race([
        writerPidReady,
        writePromise.then(() => {
          throw new Error("write_finished_before_pid_observation");
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
      results = await Promise.allSettled([blockerPromise, writePromise]);
    }

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "fulfilled", value: true });
    expect(await activityRows(allianceId)).toHaveLength(1);
  });

  it("consumes a matching picker pending and preserves stale, foreign, or newer rows", async () => {
    const allianceId = await insertAlliance();
    const otherAllianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const { discordUserId, linkId } = await insertDiscordActor(
      allianceId,
      memberId,
    );
    const expected: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: [linkId],
      active: true,
    };
    const requiredPending = {
      expected,
      required: true,
      linkId,
    };

    await seedDiscordPending({
      discordUserId,
      allianceId: otherAllianceId,
      pending: expected,
    });
    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId },
          pending: requiredPending,
        },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);
    expect(await pendingRow(discordUserId)).toBeTruthy();

    await seedDiscordPending({
      discordUserId,
      allianceId,
      pending: expected,
      expiresInMs: -1000,
    });
    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId },
          pending: requiredPending,
        },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);
    expect(await pendingRow(discordUserId)).toBeTruthy();

    const newer: WeeklyPassPending = {
      ...expected,
      linkIds: [linkId, "wp-it-other-link"],
    };
    await seedDiscordPending({
      discordUserId,
      allianceId,
      pending: newer,
    });
    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId },
          pending: requiredPending,
        },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);
    expect(await pendingRow(discordUserId)).toMatchObject({
      pendingJson: newer,
    });

    const changed = await setWeeklyPass({
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: true,
      source: "self",
      activity: {
        identity: { kind: "discord", discordUserId },
        pending: { expected: newer, required: true, linkId },
      },
    });
    expect(changed).toBe(true);
    expect(await pendingRow(discordUserId)).toBeUndefined();
    expect(await activityRows(allianceId)).toHaveLength(1);
  });

  it("consumes a matching prompt even when the write is a no-op", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId, {
      weeklyPassActive: true,
      weeklyPassSource: "self",
    });
    const { discordUserId, linkId } = await insertDiscordActor(
      allianceId,
      memberId,
    );
    const expected: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: [linkId],
      active: true,
    };
    await seedDiscordPending({ discordUserId, allianceId, pending: expected });

    const changed = await setWeeklyPass({
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: true,
      source: "self",
      activity: {
        identity: { kind: "discord", discordUserId },
        pending: { expected, required: true, linkId },
      },
    });
    expect(changed).toBe(false);
    expect(await pendingRow(discordUserId)).toBeUndefined();
    expect(await activityRows(allianceId)).toHaveLength(0);
  });

  it("rejects a required pending that disagrees with the picked action", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const { discordUserId, linkId } = await insertDiscordActor(
      allianceId,
      memberId,
    );
    const expected: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: [linkId],
      active: true,
    };
    await seedDiscordPending({ discordUserId, allianceId, pending: expected });

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: false,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId },
          pending: { expected, required: true, linkId },
        },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);
    expect(await pendingRow(discordUserId)).toBeTruthy();
    expect(await activityRows(allianceId)).toHaveLength(0);
  });

  it("rejects a pending linkId bound to another link or member", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const { discordUserId, linkId } = await insertDiscordActor(
      allianceId,
      memberId,
    );
    const expected: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: [linkId],
      active: true,
    };
    await seedDiscordPending({ discordUserId, allianceId, pending: expected });

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId },
          pending: { expected, required: true, linkId: "wp-it-missing-link" },
        },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId },
          pending: {
            expected: { ...expected, linkIds: ["wp-it-other-link"] },
            required: false,
            linkId: "wp-it-other-link",
          },
        },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);
    expect(await pendingRow(discordUserId)).toBeTruthy();
  });

  it("rejects pending consumption for a web identity", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);

    await expect(
      setWeeklyPass(
        selfInput(commanderId, memberId, allianceId, principal, {
          activity: {
            identity: { kind: "web", principal },
            pending: {
              expected: {
                kind: "weekly_pass_pick_character",
                linkIds: ["link-1"],
                active: true,
              },
              required: false,
              linkId: "link-1",
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);
  });

  it("rejects a target that left the exact alliance membership", async () => {
    const allianceId = await insertAlliance();
    const otherAllianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const principal = await insertWebActor(allianceId, commanderId);
    const officer = await insertWebActor(allianceId, commanderId, [
      "members:write",
    ]);

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: uid("other-member"),
        active: true,
        source: "self",
        activity: { identity: { kind: "web", principal } },
      }),
    ).rejects.toBeInstanceOf(ActivityWriteError);

    await expect(
      setWeeklyPass(
        selfInput(commanderId, memberId, allianceId, principal, {
          allianceId: otherAllianceId,
        }),
      ),
    ).rejects.toBeInstanceOf(ActivityWriteError);

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: uid("other-member"),
        active: true,
        source: "officer",
        activity: { identity: { kind: "web", principal: officer } },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassTargetChangedError);
    expect(await activityRows(allianceId)).toHaveLength(0);
  });

  it("optional pending consumes only an exact match and preserves a newer prompt", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const { discordUserId, linkId } = await insertDiscordActor(
      allianceId,
      memberId,
    );
    const expected: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: [linkId],
      active: true,
    };
    const newer: WeeklyPassPending = {
      ...expected,
      linkIds: [linkId, "wp-it-other-link"],
    };
    await seedDiscordPending({
      discordUserId,
      allianceId,
      pending: newer,
    });

    const changed = await setWeeklyPass({
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: true,
      source: "self",
      activity: {
        identity: { kind: "discord", discordUserId },
        pending: { expected, required: false, linkId },
      },
    });
    expect(changed).toBe(true);
    expect(await activityRows(allianceId)).toHaveLength(1);
    expect(await pendingRow(discordUserId)).toMatchObject({
      pendingJson: newer,
    });

    const changedAgain = await setWeeklyPass({
      commanderId,
      allianceId,
      ashedMemberId: memberId,
      active: false,
      source: "self",
      activity: {
        identity: { kind: "discord", discordUserId },
        pending: { expected: newer, required: false, linkId },
      },
    });
    expect(changedAgain).toBe(true);
    expect(await pendingRow(discordUserId)).toBeUndefined();
    expect(await activityRows(allianceId)).toHaveLength(2);
  });

  it("rejects a required pending whose linkId resolves to another member's link", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const { memberId: otherMemberId } = await insertCommanderFixture(allianceId);
    const { discordUserId } = await insertDiscordActor(allianceId, memberId);
    const { linkId: foreignLinkId } = await insertDiscordActor(
      allianceId,
      otherMemberId,
    );
    const expected: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: [foreignLinkId],
      active: true,
    };
    await seedDiscordPending({
      discordUserId,
      allianceId,
      pending: expected,
    });

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId },
          pending: { expected, required: true, linkId: foreignLinkId },
        },
      }),
    ).rejects.toBeInstanceOf(WeeklyPassPendingChangedError);
    expect(await pendingRow(discordUserId)).toMatchObject({
      pendingJson: expected,
    });
    const commander = await commanderRow(commanderId);
    expect(commander?.weeklyPassActive).toBe(false);
    expect(await activityRows(allianceId)).toHaveLength(0);
  });

  it("getDiscordBotPending expiry keeps a prompt saved between read and cleanup", async () => {
    const allianceId = await insertAlliance();
    const discordUserId = uid("discord");
    const expired: WeeklyPassPending = {
      kind: "weekly_pass_pick_character",
      linkIds: ["wp-it-stale-link"],
      active: true,
    };
    await seedDiscordPending({
      discordUserId,
      allianceId,
      pending: expired,
      expiresInMs: -1000,
    });
    const expiredRow = await pendingRow(discordUserId);
    const newer: WeeklyPassPending = { ...expired, active: false };

    const db = getDb();
    const spy = vi.spyOn(db, "select").mockImplementationOnce(
      () =>
        ({
          from: () => ({
            where: () => ({
              limit: async () => {
                await seedDiscordPending({
                  discordUserId,
                  allianceId,
                  pending: newer,
                });
                return [expiredRow];
              },
            }),
          }),
        }) as never,
    );

    let result: unknown;
    try {
      result = await getDiscordBotPending(discordUserId);
    } finally {
      spy.mockRestore();
    }
    expect(result).toBeNull();
    expect(await pendingRow(discordUserId)).toMatchObject({
      pendingJson: newer,
    });
  });

  it("getDiscordBotPending removes a still-expired row", async () => {
    const allianceId = await insertAlliance();
    const discordUserId = uid("discord");
    await seedDiscordPending({
      discordUserId,
      allianceId,
      pending: {
        kind: "weekly_pass_pick_character",
        linkIds: ["wp-it-stale-link"],
        active: true,
      },
      expiresInMs: -1000,
    });

    expect(await getDiscordBotPending(discordUserId)).toBeNull();
    expect(await pendingRow(discordUserId)).toBeUndefined();
  });

  it("denies officer writes for underprivileged or non-web identities", async () => {
    const allianceId = await insertAlliance();
    const { commanderId, memberId } = await insertCommanderFixture(allianceId);
    const memberOnly = principalFor({
      hqUserId: uid("hq-under"),
      sessionId: uid("sess-under"),
      allianceId,
      permissions: ["members:read"],
    });
    const { discordUserId } = await insertDiscordActor(allianceId, memberId);

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "officer",
        activity: { identity: { kind: "web", principal: memberOnly } },
      }),
    ).rejects.toBeInstanceOf(ActivityWriteError);

    await expect(
      setWeeklyPass({
        commanderId,
        allianceId,
        ashedMemberId: memberId,
        active: true,
        source: "officer",
        activity: { identity: { kind: "discord", discordUserId } },
      }),
    ).rejects.toBeInstanceOf(ActivityWriteError);
    expect(await activityRows(allianceId)).toHaveLength(0);
    const commander = await commanderRow(commanderId);
    expect(commander?.weeklyPassActive).toBe(false);
  });
});
