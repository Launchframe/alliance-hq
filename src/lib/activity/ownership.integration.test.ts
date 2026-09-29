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

vi.mock("./monitoring.server", () => ({
  scheduleActivityBlockedAlert: vi.fn(),
}));

import { getDb, resetDbPool, schema } from "@/lib/db";
import { postgresErrorCode } from "@/lib/db/error-message";
import { upsertDiscordHqLink } from "@/lib/vr/repository";

import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import type { ActivityEventInput } from "./catalog.shared";
import { scheduleActivityBlockedAlert } from "./monitoring.server";
import {
  ActivityIdentityChangedError,
  claimDiscordActivityOwnership,
  lockActivityIdentity,
  lockActivityMergeOwners,
  remapActivityOwnership,
} from "./ownership.server";
import { appendActivityEvent, withActivityTransaction } from "./writer.server";

const enabled = process.env.ACTIVITY_DB_TEST === "1";
const alertMock = vi.mocked(scheduleActivityBlockedAlert);

const NAMESPACE = "activity-ownership-integration";
const FIXED_OCCURRED_AT = "2026-09-29T12:00:00.123456Z";
const FIXED_VALUE = "123456789012345678901234567890";

function hqInput(hqUserId: string, sourceKey?: string): ActivityEventInput {
  const uuid = randomUUID();
  return {
    eventKey: "thp.submitted",
    actor: {
      kind: "hq",
      hqUserId,
      personalOwnerHqUserId: hqUserId,
      discordUserId: null,
      commanderId: null,
      displayName: "Ownership test",
      hqRole: "officer",
      gameRank: "R4",
    },
    scope: {
      allianceId: `activity-test-alliance-${uuid}`,
      serverNumber: "1203",
      allianceTag: "TEST",
      allianceName: "Ownership test",
    },
    channel: "web",
    method: "manual",
    occurredAt: FIXED_OCCURRED_AT,
    source: { namespace: NAMESPACE, key: sourceKey ?? uuid },
    severity: "update",
    payload: { value: FIXED_VALUE },
  };
}

function discordInput(
  discordUserId: string,
  allianceId?: string,
  sourceKey?: string,
): ActivityEventInput {
  const input = hqInput("activity-test-unused", sourceKey);
  return {
    ...input,
    actor: {
      kind: "discord",
      hqUserId: null,
      personalOwnerHqUserId: null,
      discordUserId,
      commanderId: null,
      displayName: "Discord actor",
      hqRole: null,
      gameRank: null,
    },
    scope: allianceId ? { ...input.scope, allianceId } : input.scope,
    channel: "discord",
  };
}

async function insertUser(id: string) {
  await getDb()
    .insert(schema.hqUsers)
    .values({ id, email: `${id}@e2e.test`, displayName: "Ownership test" });
}

async function insertLink(discordUserId: string, hqUserId: string) {
  await getDb().insert(schema.discordHqLinks).values({
    discordUserId,
    hqUserId,
    linkedAt: new Date(),
  });
}

type EventSnapshot = {
  id: string;
  actorKind: string;
  originalHqUserId: string | null;
  originalDiscordUserId: string | null;
  personalOwnerHqUserId: string | null;
  actorHqRole: string | null;
  actorGameRank: string | null;
  actorDisplayName: string | null;
  occurredAt: unknown;
  contentHash: string;
  payload: unknown;
};

async function snapshotEvent(id: string): Promise<EventSnapshot> {
  const [row] = await getDb()
    .select({
      id: schema.activityEvents.id,
      actorKind: schema.activityEvents.actorKind,
      originalHqUserId: schema.activityEvents.originalHqUserId,
      originalDiscordUserId: schema.activityEvents.originalDiscordUserId,
      personalOwnerHqUserId: schema.activityEvents.personalOwnerHqUserId,
      actorHqRole: schema.activityEvents.actorHqRole,
      actorGameRank: schema.activityEvents.actorGameRank,
      actorDisplayName: schema.activityEvents.actorDisplayName,
      occurredAt: schema.activityEvents.occurredAt,
      contentHash: schema.activityEvents.contentHash,
      payload: schema.activityEvents.payload,
    })
    .from(schema.activityEvents)
    .where(eq(schema.activityEvents.id, id));
  return row;
}

describe.skipIf(!enabled)("ownership.server integration", () => {
  const createdEventIds: string[] = [];
  const createdUserIds: string[] = [];

  function trackEvent(id: string) {
    createdEventIds.push(id);
    return id;
  }

  function trackUser(id: string) {
    createdUserIds.push(id);
    return id;
  }

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
  });

  afterEach(async () => {
    vi.clearAllMocks();
    const db = getDb();
    for (const id of createdEventIds.splice(0)) {
      await db
        .delete(schema.activityEvents)
        .where(eq(schema.activityEvents.id, id));
    }
    if (createdUserIds.length > 0) {
      await db
        .delete(schema.activityOwnershipAliases)
        .where(
          inArray(schema.activityOwnershipAliases.originalHqUserId, [
            ...createdUserIds,
          ]),
        );
      await db
        .delete(schema.activityOwnershipAliases)
        .where(
          inArray(schema.activityOwnershipAliases.personalOwnerHqUserId, [
            ...createdUserIds,
          ]),
        );
    }
    for (const id of createdUserIds.splice(0)) {
      await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, id));
    }
  });

  afterAll(async () => {
    await resetDbPool();
  });

  it("claims only unowned discord rows for the verified discord identity", async () => {
    const hqA = trackUser(`activity-test-user-${randomUUID()}`);
    const hqB = trackUser(`activity-test-user-${randomUUID()}`);
    const hqC = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqA);
    await insertUser(hqB);
    await insertUser(hqC);

    const dMain = `activity-test-d-${randomUUID()}`;
    const dOther = `activity-test-d-${randomUUID()}`;
    const dStray = `activity-test-d-${randomUUID()}`;
    await insertLink(dOther, hqB);

    const allianceA = `activity-test-alliance-${randomUUID()}`;
    const allianceB = `activity-test-alliance-${randomUUID()}`;

    const e1 = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, discordInput(dMain, allianceA)),
        )
      ).id,
    );
    const e2 = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, discordInput(dMain, allianceB)),
        )
      ).id,
    );
    const eb = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, discordInput(dOther, allianceA)),
        )
      ).id,
    );
    const e3 = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, discordInput(dStray, allianceB)),
        )
      ).id,
    );

    const before = await snapshotEvent(e1);
    expect(before.personalOwnerHqUserId).toBeNull();
    expect((await snapshotEvent(eb)).personalOwnerHqUserId).toBe(hqB);

    await upsertDiscordHqLink({ discordUserId: dMain, hqUserId: hqA });

    expect((await snapshotEvent(e1)).personalOwnerHqUserId).toBe(hqA);
    expect((await snapshotEvent(e2)).personalOwnerHqUserId).toBe(hqA);
    expect((await snapshotEvent(eb)).personalOwnerHqUserId).toBe(hqB);
    expect((await snapshotEvent(e3)).personalOwnerHqUserId).toBeNull();

    const after = await snapshotEvent(e1);
    expect(after.originalDiscordUserId).toBe(before.originalDiscordUserId);
    expect(after.actorKind).toBe(before.actorKind);
    expect(after.occurredAt).toEqual(before.occurredAt);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.payload).toEqual(before.payload);

    await upsertDiscordHqLink({ discordUserId: dMain, hqUserId: hqA });
    expect((await snapshotEvent(e1)).personalOwnerHqUserId).toBe(hqA);
    expect((await snapshotEvent(e2)).personalOwnerHqUserId).toBe(hqA);

    await getDb()
      .delete(schema.discordHqLinks)
      .where(eq(schema.discordHqLinks.discordUserId, dMain));
    await upsertDiscordHqLink({ discordUserId: dMain, hqUserId: hqC });

    expect((await snapshotEvent(e1)).personalOwnerHqUserId).toBe(hqA);
    expect((await snapshotEvent(e2)).personalOwnerHqUserId).toBe(hqA);
    expect((await snapshotEvent(eb)).personalOwnerHqUserId).toBe(hqB);
    expect((await snapshotEvent(e3)).personalOwnerHqUserId).toBeNull();
  });

  it("commits the link and claims atomically and rolls both back on failure", async () => {
    const hqA = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqA);
    const hqRollback = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqRollback);
    const hqDupe = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqDupe);

    const dCommit = `activity-test-d-${randomUUID()}`;
    const eCommit = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, discordInput(dCommit)),
        )
      ).id,
    );

    await upsertDiscordHqLink({ discordUserId: dCommit, hqUserId: hqA });

    const link = await getDb()
      .select({ hqUserId: schema.discordHqLinks.hqUserId })
      .from(schema.discordHqLinks)
      .where(eq(schema.discordHqLinks.discordUserId, dCommit));
    expect(link).toEqual([{ hqUserId: hqA }]);
    expect((await snapshotEvent(eCommit)).personalOwnerHqUserId).toBe(hqA);

    const dFail = `activity-test-d-${randomUUID()}`;
    const eFail = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, discordInput(dFail)),
        )
      ).id,
    );

    let reachedClaim = false;
    let caught: unknown;
    try {
      await withActivityTransaction(async (tx) => {
        await lockActivityIdentity(tx, {
          discordUserId: dFail,
          hqUserIds: [hqRollback],
        });
        const now = new Date();
        await tx
          .insert(schema.discordHqLinks)
          .values({
            discordUserId: dFail,
            hqUserId: hqRollback,
            linkedAt: now,
          });
        await claimDiscordActivityOwnership(tx, {
          discordUserId: dFail,
          hqUserId: hqRollback,
        });
        const [claimed] = await tx
          .select({
            owner: schema.activityEvents.personalOwnerHqUserId,
          })
          .from(schema.activityEvents)
          .where(eq(schema.activityEvents.id, eFail));
        expect(claimed.owner).toBe(hqRollback);
        reachedClaim = true;
        await tx.insert(schema.hqUsers).values({
          id: hqDupe,
          email: `${hqDupe}@e2e.test`,
          displayName: "Duplicate",
        });
      });
    } catch (error) {
      caught = error;
    }

    expect(reachedClaim).toBe(true);
    expect(postgresErrorCode(caught)).toBe("23505");
    expect(alertMock).not.toHaveBeenCalled();

    const links = await getDb()
      .select({ hqUserId: schema.discordHqLinks.hqUserId })
      .from(schema.discordHqLinks)
      .where(eq(schema.discordHqLinks.discordUserId, dFail));
    expect(links).toEqual([]);
    expect((await snapshotEvent(eFail)).personalOwnerHqUserId).toBeNull();
  });

  it("flattens the alias ledger across chained remaps and keeps snapshots immutable", async () => {
    const hqA = trackUser(`activity-test-user-${randomUUID()}`);
    const hqB = trackUser(`activity-test-user-${randomUUID()}`);
    const hqC = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqA);
    await insertUser(hqB);
    await insertUser(hqC);

    const inputA = hqInput(hqA);
    const eA = trackEvent(
      (
        await getDb().transaction((tx) => appendActivityEvent(tx, inputA))
      ).id,
    );
    const snapshotA = await snapshotEvent(eA);
    expect(snapshotA.personalOwnerHqUserId).toBe(hqA);

    await getDb().transaction((tx) => remapActivityOwnership(tx, hqA, hqB));
    expect((await snapshotEvent(eA)).personalOwnerHqUserId).toBe(hqB);

    const hqOther = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqOther);
    await expect(
      getDb().transaction((tx) =>
        remapActivityOwnership(tx, hqA, hqOther),
      ),
    ).rejects.toBeInstanceOf(ActivityIdentityChangedError);
    expect((await snapshotEvent(eA)).personalOwnerHqUserId).toBe(hqB);
    const afterReject = await getDb()
      .select()
      .from(schema.activityOwnershipAliases)
      .where(eq(schema.activityOwnershipAliases.originalHqUserId, hqA));
    expect(afterReject).toEqual([
      { originalHqUserId: hqA, personalOwnerHqUserId: hqB },
    ]);

    const lateA = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, hqInput(hqA)),
        )
      ).id,
    );
    expect((await snapshotEvent(lateA)).personalOwnerHqUserId).toBe(hqB);

    await getDb().transaction((tx) => remapActivityOwnership(tx, hqB, hqC));

    const aliases = await getDb()
      .select()
      .from(schema.activityOwnershipAliases)
      .where(
        inArray(schema.activityOwnershipAliases.originalHqUserId, [
          hqA,
          hqB,
        ]),
      );
    expect(aliases).toHaveLength(2);
    expect(aliases).toEqual(
      expect.arrayContaining([
        { originalHqUserId: hqA, personalOwnerHqUserId: hqC },
        { originalHqUserId: hqB, personalOwnerHqUserId: hqC },
      ]),
    );

    expect((await snapshotEvent(eA)).personalOwnerHqUserId).toBe(hqC);
    expect((await snapshotEvent(lateA)).personalOwnerHqUserId).toBe(hqC);

    const laterA = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, hqInput(hqA)),
        )
      ).id,
    );
    expect((await snapshotEvent(laterA)).personalOwnerHqUserId).toBe(hqC);

    const remapped = await snapshotEvent(eA);
    expect(remapped.originalHqUserId).toBe(snapshotA.originalHqUserId);
    expect(remapped.actorHqRole).toBe(snapshotA.actorHqRole);
    expect(remapped.actorGameRank).toBe(snapshotA.actorGameRank);
    expect(remapped.actorDisplayName).toBe(snapshotA.actorDisplayName);
    expect(remapped.occurredAt).toEqual(snapshotA.occurredAt);
    expect(remapped.contentHash).toBe(snapshotA.contentHash);

    const replay = await getDb().transaction((tx) =>
      appendActivityEvent(tx, inputA),
    );
    expect(replay).toEqual({ id: eA, inserted: false });
  });

  it("serializes a late writer against a merge so every event lands on the canonical owner", async () => {
    const hqA = trackUser(`activity-test-user-${randomUUID()}`);
    const hqB = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqA);
    await insertUser(hqB);

    let lockedResolve!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockedResolve = resolve;
    });
    let releaseWriter!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let writtenId: string | undefined;

    const writerPromise = getDb().transaction(async (tx) => {
      await lockActivityIdentity(tx, { hqUserIds: [hqA] });
      const result = await appendActivityEvent(tx, hqInput(hqA));
      writtenId = result.id;
      trackEvent(result.id);
      lockedResolve();
      await released;
    });
    await Promise.race([
      locked,
      writerPromise.then(() => {
        throw new Error("writer_finished_before_barrier");
      }),
    ]);

    let startedResolve!: (pid: number) => void;
    const started = new Promise<number>((resolve) => {
      startedResolve = resolve;
    });
    const mergePromise = getDb().transaction(async (tx) => {
      const pidRows = (await tx.execute(
        sql`select pg_backend_pid() as pid`,
      )) as unknown as { pid: number }[];
      startedResolve(Number(pidRows[0].pid));
      await lockActivityMergeOwners(tx, hqA, hqB);
      await remapActivityOwnership(tx, hqA, hqB);
      await tx
        .delete(schema.hqUsers)
        .where(eq(schema.hqUsers.id, hqA));
    });
    let results: PromiseSettledResult<void>[] = [];
    try {
      const mergePid = await Promise.race([
        started,
        mergePromise.then(() => {
          throw new Error("merge_finished_before_lock_observation");
        }),
      ]);
      await vi.waitFor(
        async () => {
          const [row] = (await getDb().execute(
            sql`select exists(select 1 from pg_locks where pid = ${mergePid} and locktype = 'advisory' and not granted) as waiting`,
          )) as unknown as { waiting: boolean }[];
          expect(row.waiting).toBe(true);
        },
        { timeout: 5000, interval: 20 },
      );
    } finally {
      releaseWriter();
      results = await Promise.allSettled([writerPromise, mergePromise]);
    }

    const [writerResult, mergeResult] = results;
    expect(writerResult.status).toBe("fulfilled");
    expect(mergeResult.status).toBe("fulfilled");
    expect(writtenId).toBeDefined();

    expect((await snapshotEvent(writtenId!)).personalOwnerHqUserId).toBe(
      hqB,
    );

    const late = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, hqInput(hqA)),
        )
      ).id,
    );
    expect((await snapshotEvent(late)).personalOwnerHqUserId).toBe(hqB);
  });

  it("serializes an unlinked discord writer against a claim so no orphan remains", async () => {
    const hqA = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqA);

    const dLinked = `activity-test-d-${randomUUID()}`;
    await insertLink(dLinked, hqA);
    const direct = trackEvent(
      (
        await getDb().transaction((tx) =>
          appendActivityEvent(tx, discordInput(dLinked)),
        )
      ).id,
    );
    expect((await snapshotEvent(direct)).personalOwnerHqUserId).toBe(hqA);

    const hqB = trackUser(`activity-test-user-${randomUUID()}`);
    await insertUser(hqB);
    const dRace = `activity-test-d-${randomUUID()}`;
    let lockedResolve!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockedResolve = resolve;
    });
    let releaseWriter!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let writtenId: string | undefined;

    const writerPromise = getDb().transaction(async (tx) => {
      await lockActivityIdentity(tx, { discordUserId: dRace });
      const result = await appendActivityEvent(tx, discordInput(dRace));
      writtenId = result.id;
      trackEvent(result.id);
      lockedResolve();
      await released;
    });
    await Promise.race([
      locked,
      writerPromise.then(() => {
        throw new Error("writer_finished_before_barrier");
      }),
    ]);

    let startedResolve!: (pid: number) => void;
    const started = new Promise<number>((resolve) => {
      startedResolve = resolve;
    });
    const claimPromise = getDb().transaction(async (tx) => {
      const pidRows = (await tx.execute(
        sql`select pg_backend_pid() as pid`,
      )) as unknown as { pid: number }[];
      startedResolve(Number(pidRows[0].pid));
      await lockActivityIdentity(tx, {
        discordUserId: dRace,
        hqUserIds: [hqB],
      });
      await tx.insert(schema.discordHqLinks).values({
        discordUserId: dRace,
        hqUserId: hqB,
        linkedAt: new Date(),
      });
      await claimDiscordActivityOwnership(tx, {
        discordUserId: dRace,
        hqUserId: hqB,
      });
    });
    let results: PromiseSettledResult<void>[] = [];
    try {
      const claimPid = await Promise.race([
        started,
        claimPromise.then(() => {
          throw new Error("claim_finished_before_lock_observation");
        }),
      ]);
      await vi.waitFor(
        async () => {
          const [row] = (await getDb().execute(
            sql`select exists(select 1 from pg_locks where pid = ${claimPid} and locktype = 'advisory' and not granted) as waiting`,
          )) as unknown as { waiting: boolean }[];
          expect(row.waiting).toBe(true);
        },
        { timeout: 5000, interval: 20 },
      );
    } finally {
      releaseWriter();
      results = await Promise.allSettled([writerPromise, claimPromise]);
    }

    const [writerResult, claimResult] = results;
    expect(writerResult.status).toBe("fulfilled");
    expect(claimResult.status).toBe("fulfilled");
    expect(writtenId).toBeDefined();

    expect((await snapshotEvent(writtenId!)).personalOwnerHqUserId).toBe(
      hqB,
    );
  });
});
