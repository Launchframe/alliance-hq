import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const nanoidState = vi.hoisted(() => ({ forcedId: null as string | null }));
vi.mock("nanoid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nanoid")>();
  return {
    ...actual,
    nanoid: () => nanoidState.forcedId ?? actual.nanoid(),
  };
});

vi.mock("./monitoring.server", () => ({
  scheduleActivityBlockedAlert: vi.fn(),
}));

import { getDb, resetDbPool, schema } from "@/lib/db";

import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import type { ActivityEventInput } from "./catalog.shared";
import { ActivityWriteError } from "./errors.server";
import { scheduleActivityBlockedAlert } from "./monitoring.server";
import { appendActivityEvent, withActivityTransaction } from "./writer.server";

const enabled = process.env.ACTIVITY_DB_TEST === "1";
const alertMock = vi.mocked(scheduleActivityBlockedAlert);

const NAMESPACE = "activity-integration";
const FIXED_OCCURRED_AT = "2026-09-29T12:00:00.123456Z";
const FIXED_VALUE = "123456789012345678901234567890";

function makeInput(overrides: { sourceKey?: string; value?: string } = {}) {
  const uuid = randomUUID();
  const input: ActivityEventInput = {
    eventKey: "thp.submitted",
    actor: {
      kind: "hq",
      hqUserId: `activity-test-${uuid}`,
      personalOwnerHqUserId: `activity-test-${uuid}`,
      discordUserId: null,
      commanderId: null,
      displayName: "Activity test",
      hqRole: null,
      gameRank: null,
    },
    scope: {
      allianceId: `activity-test-alliance-${uuid}`,
      serverNumber: "1203",
      allianceTag: "TEST",
      allianceName: "Activity test",
    },
    channel: "web",
    method: "manual",
    occurredAt: FIXED_OCCURRED_AT,
    source: { namespace: NAMESPACE, key: overrides.sourceKey ?? uuid },
    severity: "update",
    payload: { value: overrides.value ?? FIXED_VALUE },
  };
  return input;
}

async function eventsBySource(sourceKey: string) {
  return getDb()
    .select({ id: schema.activityEvents.id })
    .from(schema.activityEvents)
    .where(
      and(
        eq(schema.activityEvents.sourceNamespace, NAMESPACE),
        eq(schema.activityEvents.sourceKey, sourceKey),
      ),
    );
}

async function usersById(id: string) {
  return getDb()
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, id));
}

describe.skipIf(!enabled)("writer.server integration", () => {
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
      throw new Error(
        "Activity integration requires one guarded database.",
      );
    }
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        throw new Error(
          "Activity integration requires one guarded database.",
        );
      }
      assertE2eDatabaseUrl(url);
    }
  });

  beforeEach(() => {
    nanoidState.forcedId = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const db = getDb();
    for (const id of createdEventIds.splice(0)) {
      await db
        .delete(schema.activityEvents)
        .where(eq(schema.activityEvents.id, id));
    }
    for (const id of createdUserIds.splice(0)) {
      await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, id));
    }
  });

  afterAll(async () => {
    await resetDbPool();
  });

  it("rolls back the whole transaction on a genuine PG constraint failure", async () => {
    const seedId = `activity-test-${randomUUID()}`;
    nanoidState.forcedId = seedId;
    const seedInput = makeInput();
    const seeded = await getDb().transaction((tx) =>
      appendActivityEvent(tx, seedInput),
    );
    expect(seeded).toEqual({ id: seedId, inserted: true });
    trackEvent(seedId);

    const syntheticUserId = trackUser(`activity-test-user-${randomUUID()}`);
    const secondInput = makeInput();

    let caught: unknown;
    try {
      await withActivityTransaction(async (tx) => {
        await tx.insert(schema.hqUsers).values({
          id: syntheticUserId,
          email: `${syntheticUserId}@e2e.test`,
          displayName: "Activity transaction test",
        });
        await appendActivityEvent(tx, secondInput);
      });
    } catch (error) {
      caught = error;
    } finally {
      nanoidState.forcedId = null;
    }

    expect(caught).toBeInstanceOf(ActivityWriteError);
    const failure = caught as ActivityWriteError;
    expect(failure.message).toBe("activity_write_failed");
    expect(failure.cause).toBeUndefined();
    expect(failure.failureCategory).toBe("constraint");
    expect(failure.sqlState).toBe("23505");
    expect(JSON.stringify(failure)).not.toContain("hq_users");
    expect(JSON.stringify(failure)).not.toContain("INSERT");

    expect(await usersById(syntheticUserId)).toEqual([]);
    expect(await eventsBySource(secondInput.source.key)).toEqual([]);
    expect(await eventsBySource(seedInput.source.key)).toEqual([
      { id: seedId },
    ]);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toBe(failure);
  });

  it("commits native mutations and the event in one transaction", async () => {
    const syntheticUserId = trackUser(`activity-test-user-${randomUUID()}`);
    const input = makeInput();

    const result = await withActivityTransaction(async (tx) => {
      await tx.insert(schema.hqUsers).values({
        id: syntheticUserId,
        email: `${syntheticUserId}@e2e.test`,
        displayName: "Activity transaction test",
      });
      return appendActivityEvent(tx, input);
    });
    trackEvent(result.id);

    expect(result.inserted).toBe(true);
    expect(await usersById(syntheticUserId)).toEqual([
      { id: syntheticUserId },
    ]);
    expect(await eventsBySource(input.source.key)).toEqual([
      { id: result.id },
    ]);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("serializes concurrent same-source replays to one row and one id", async () => {
    const input = makeInput();
    const [first, second] = await Promise.all([
      getDb().transaction((tx) => appendActivityEvent(tx, input)),
      getDb().transaction((tx) => appendActivityEvent(tx, input)),
    ]);
    trackEvent(first.id);

    expect(second.id).toBe(first.id);
    expect([first.inserted, second.inserted].sort()).toEqual([false, true]);
    expect(await eventsBySource(input.source.key)).toEqual([
      { id: first.id },
    ]);
  });

  it("rolls back native mutations when a replay conflicts", async () => {
    const input = makeInput();
    const seeded = await getDb().transaction((tx) =>
      appendActivityEvent(tx, input),
    );
    trackEvent(seeded.id);

    const syntheticUserId = trackUser(`activity-test-user-${randomUUID()}`);
    const conflicting: ActivityEventInput = {
      ...input,
      payload: { value: "9" },
    };

    let caught: unknown;
    try {
      await withActivityTransaction(async (tx) => {
        await tx.insert(schema.hqUsers).values({
          id: syntheticUserId,
          email: `${syntheticUserId}@e2e.test`,
          displayName: "Activity transaction test",
        });
        await appendActivityEvent(tx, conflicting);
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ActivityWriteError);
    expect((caught as ActivityWriteError).failureCategory).toBe(
      "idempotency_conflict",
    );
    expect(await usersById(syntheticUserId)).toEqual([]);
    expect(await eventsBySource(input.source.key)).toEqual([
      { id: seeded.id },
    ]);
    const [row] = await getDb()
      .select({ payload: schema.activityEvents.payload })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.id, seeded.id));
    expect(row.payload).toEqual({ value: FIXED_VALUE });
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  it("round-trips microsecond timestamps and 30-digit values exactly", async () => {
    const input = makeInput();
    const result = await getDb().transaction((tx) =>
      appendActivityEvent(tx, input),
    );
    trackEvent(result.id);

    const [row] = await getDb()
      .select({
        at: sql<string>`to_char(${schema.activityEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        payload: schema.activityEvents.payload,
      })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.id, result.id));

    expect(row.at).toBe(FIXED_OCCURRED_AT);
    expect((row.payload as { value: string }).value).toBe(FIXED_VALUE);
  });
});
