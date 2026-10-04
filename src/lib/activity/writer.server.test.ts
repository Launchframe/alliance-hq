import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import type { ActivityEventInput } from "./catalog.shared";
import { ActivityWriteError, toActivityWriteError } from "./errors.server";
import {
  appendActivityEvent,
  reportActivityRollback,
  withActivityTransaction,
} from "./writer.server";
import * as monitoringModule from "./monitoring.server";

vi.mock("./monitoring.server", async (importOriginal) => {
  const actual = await importOriginal<typeof monitoringModule>();
  return {
    ...actual,
    scheduleActivityBlockedAlert: vi.fn(),
  };
});

const scheduleSpy = vi.mocked(monitoringModule.scheduleActivityBlockedAlert);

const validInput = {
  eventKey: "thp.submitted",
  actor: {
    kind: "hq",
    hqUserId: "hq-user-secret",
    discordUserId: null,
    personalOwnerHqUserId: "hq-user-secret",
    commanderId: null,
    displayName: "Commander One",
    hqRole: "officer",
    gameRank: "R4",
  },
  scope: {
    allianceId: "alliance-1",
    serverNumber: "1234",
    allianceTag: "LFgo",
    allianceName: "Launchframe",
  },
  channel: "web",
  method: "manual",
  occurredAt: new Date("2026-09-29T12:00:00.000Z"),
  source: { namespace: "test-suite", key: "secret-source-key" },
  severity: "update",
  payload: { value: "99887766554433221100" },
} as const satisfies ActivityEventInput;

type TxRow = Record<string, unknown>;

function makeTx(options: {
  returningRows: TxRow[];
  selectRows?: () => TxRow[];
  insertError?: unknown;
}) {
  const returning = vi.fn().mockResolvedValue(options.returningRows);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn<
    (row: TxRow) => { onConflictDoNothing: typeof onConflictDoNothing }
  >(() => ({ onConflictDoNothing }));
  if (options.insertError) {
    onConflictDoNothing.mockImplementation(() => {
      throw options.insertError;
    });
  }
  const limit = vi
    .fn()
    .mockImplementation(() => Promise.resolve(options.selectRows?.() ?? []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const insert = vi.fn(() => ({ values }));
  return { insert, values, onConflictDoNothing, returning, select, limit };
}

describe("appendActivityEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("inserts derived catalog fields through the caller transaction", async () => {
    const tx = makeTx({ returningRows: [{ id: "evt-1" }] });

    const result = await appendActivityEvent(tx as never, { ...validInput });

    expect(result).toEqual({ id: "evt-1", inserted: true });
    expect(tx.insert).toHaveBeenCalledTimes(1);
    const row = tx.values.mock.calls[0][0];
    expect(row.eventKey).toBe("thp.submitted");
    expect(row.feature).toBe("thp");
    expect(row.kind).toBe("change");
    expect(row.visibilityClass).toBe("alliance");
    expect(row.descriptor).toBeUndefined();
    expect(row.occurredAt).toBe("2026-09-29T12:00:00.000000Z");
    expect(row.actorKind).toBe("hq");
    expect(row.originalHqUserId).toBe("hq-user-secret");
    expect(row.personalOwnerHqUserId).toBe("hq-user-secret");
    expect(row.actorGameRank).toBe("R4");
    expect(row.actorHqRole).toBe("officer");
    expect(row.resourceKind).toBeNull();
    expect(row.sourceNamespace).toBe("test-suite");
    expect(row.sourceKey).toBe("secret-source-key");
    expect(row.payload).toEqual({ value: "99887766554433221100" });
    expect(row.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof row.id).toBe("string");
    expect(row.recordedAt).toBeUndefined();
    expect(row.schemaVersion).toBe(1);

    const conflictArgs = tx.onConflictDoNothing.mock.calls[0] as unknown as [
      { target: { name: string }[] },
    ];
    expect(conflictArgs[0].target.map((column) => column.name)).toEqual([
      "source_namespace",
      "source_key",
    ]);
  });

  it("retains an exact six-fractional-digit ISO occurredAt unchanged", async () => {
    const tx = makeTx({ returningRows: [{ id: "evt-1" }] });
    await appendActivityEvent(tx as never, {
      ...validInput,
      occurredAt: "2026-09-29T12:00:00.123456Z",
    });
    expect(tx.values.mock.calls[0][0].occurredAt).toBe(
      "2026-09-29T12:00:00.123456Z",
    );
  });

  it("produces identical content hashes across key order and timestamp forms", async () => {
    const captured: string[] = [];
    const txFor = () => {
      const returning = vi.fn().mockResolvedValue([{ id: "evt" }]);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn((row: TxRow) => {
        captured.push(row.contentHash as string);
        return { onConflictDoNothing };
      });
      const insert = vi.fn(() => ({ values }));
      return { insert, values };
    };

    await appendActivityEvent(txFor() as never, {
      ...validInput,
      payload: { value: "5", previousValue: "3" },
    });
    await appendActivityEvent(txFor() as never, {
      ...validInput,
      payload: { previousValue: "3", value: "5" },
    });
    expect(captured[0]).toBe(captured[1]);

    captured.length = 0;
    await appendActivityEvent(txFor() as never, {
      ...validInput,
      occurredAt: new Date("2026-09-29T12:00:00.123Z"),
    });
    await appendActivityEvent(txFor() as never, {
      ...validInput,
      occurredAt: "2026-09-29T12:00:00.123000Z",
    });
    expect(captured[0]).toBe(captured[1]);
  });

  it("returns the existing id on an identical replay via the same tx", async () => {
    let capturedHash: string | undefined;
    const tx = makeTx({
      returningRows: [],
      selectRows: () => [
        { id: "existing-id", contentHash: capturedHash },
      ],
    });
    const originalValues = tx.values.getMockImplementation();
    tx.values.mockImplementation((row: TxRow) => {
      capturedHash = row.contentHash as string;
      return originalValues!(row);
    });

    const result = await appendActivityEvent(tx as never, {
      ...validInput,
    });

    expect(result).toEqual({ id: "existing-id", inserted: false });
    expect(tx.select).toHaveBeenCalledTimes(1);
  });

  it("throws idempotency_conflict when the source pair holds different content", async () => {
    const tx = makeTx({
      returningRows: [],
      selectRows: () => [{ id: "other-id", contentHash: "f".repeat(64) }],
    });

    const error = await appendActivityEvent(tx as never, {
      ...validInput,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActivityWriteError);
    expect((error as ActivityWriteError).failureCategory).toBe(
      "idempotency_conflict",
    );
    expect((error as ActivityWriteError).message).toBe("activity_write_failed");
  });

  it("sanitizes driver constraint errors without leaking text or cause", async () => {
    const driverError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "activity_source_unique" parameters: secret-source-key',
      ),
      { code: "23505" },
    );
    const tx = makeTx({ returningRows: [], insertError: driverError });

    const error = await appendActivityEvent(tx as never, {
      ...validInput,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActivityWriteError);
    const writeError = error as ActivityWriteError;
    expect(writeError.failureCategory).toBe("constraint");
    expect(writeError.sqlState).toBe("23505");
    expect(writeError.eventKey).toBe("thp.submitted");
    expect(writeError.message).toBe("activity_write_failed");
    expect(writeError.cause).toBeUndefined();
    expect(JSON.stringify(writeError)).not.toContain("secret-source-key");
    expect(writeError.incidentId).toMatch(/^[0-9a-f-]{36}$/);

    const failureLogs = vi
      .mocked(console.error)
      .mock.calls.map((call) => call.map(String).join(" "))
      .join("\n");
    expect(failureLogs).toContain("activity_write_failure");
    expect(failureLogs).toContain("23505");
    expect(failureLogs).not.toContain("duplicate key");
    expect(failureLogs).not.toContain("secret-source-key");
  });

  it("classifies unknown non-driver errors", async () => {
    const tx = makeTx({
      returningRows: [],
      insertError: new Error("boom"),
    });

    const error = await appendActivityEvent(tx as never, {
      ...validInput,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActivityWriteError);
    expect((error as ActivityWriteError).failureCategory).toBe("unknown");
    expect((error as ActivityWriteError).sqlState).toBeNull();
  });

  it("rejects invalid input as validation without touching the tx", async () => {
    const tx = makeTx({ returningRows: [{ id: "evt-1" }] });

    const error = await appendActivityEvent(tx as never, {
      ...validInput,
      payload: { value: "99887766554433221100", gameUid: "123456789012" },
    } as never).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActivityWriteError);
    expect((error as ActivityWriteError).failureCategory).toBe("validation");
    expect((error as ActivityWriteError).eventKey).toBe("thp.submitted");
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("sanitizes an unrecognized eventKey on validation failures", async () => {
    const tx = makeTx({ returningRows: [] });
    const error = await appendActivityEvent(tx as never, {
      ...validInput,
      eventKey: "made.up",
    } as never).catch((caught: unknown) => caught);
    expect((error as ActivityWriteError).eventKey).toBe("unknown");
  });

  it("logs no actor, source, or payload values in write signals", async () => {
    const infoSpy = vi.mocked(console.info);
    const errorSpy = vi.mocked(console.error);
    const tx = makeTx({ returningRows: [{ id: "evt-1" }] });
    await appendActivityEvent(tx as never, { ...validInput });

    const logged = [...infoSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => call.map(String).join(" "))
      .join("\n");
    expect(logged).toContain("activity_write_attempt");
    expect(logged).toContain("activity_write_success");
    expect(logged).toContain("thp.submitted");
    expect(logged).not.toContain("hq-user-secret");
    expect(logged).not.toContain("secret-source-key");
    expect(logged).not.toContain("99887766554433221100");
  });
});

describe("ActivityEventInput narrowing", () => {
  it("narrows the payload type from the eventKey discriminant", () => {
    const promoted: ActivityEventInput = {
      ...validInput,
      eventKey: "member.promoted",
      payload: { member: "Bob", fromRank: "R2", toRank: "R4" },
    };
    const toRank = (input: ActivityEventInput): string | null =>
      input.eventKey === "member.promoted" ? input.payload.toRank : null;
    expect(toRank(promoted)).toBe("R4");
  });
});

describe("toActivityWriteError", () => {
  it.each([
    ["42P01", "missing_schema"],
    ["42703", "missing_schema"],
    ["42501", "permission"],
    ["08006", "connection"],
    ["23514", "constraint"],
  ])("classifies SQLSTATE %s as %s", (code, category) => {
    const driverError = Object.assign(
      new Error(`driver text with secret ${code}`),
      { code },
    );
    const classified = toActivityWriteError(driverError, "thp.submitted");
    expect(classified).toBeInstanceOf(ActivityWriteError);
    expect(classified.sqlState).toBe(code);
    expect(classified.failureCategory).toBe(category);
    expect(classified.message).toBe("activity_write_failed");
    expect(JSON.stringify(classified)).not.toContain("secret");
  });

  it("passes typed errors through unchanged", () => {
    const original = new ActivityWriteError({
      eventKey: "vr.submitted",
      failureCategory: "validation",
      sqlState: null,
    });
    expect(toActivityWriteError(original, "thp.submitted")).toBe(original);
  });

  it("classifies non-whitelisted sql states as unknown", () => {
    const classified = toActivityWriteError(
      Object.assign(new Error("bad"), { code: "XX###" }),
      "bogus.key",
    );
    expect(classified.failureCategory).toBe("unknown");
    expect(classified.sqlState).toBeNull();
    expect(classified.eventKey).toBe("unknown");
  });
});

describe("withActivityTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("commits work results and does not alert on success", async () => {
    const tx = makeTx({ returningRows: [{ id: "evt-1" }] });
    const committed: string[] = [];
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
        work(tx),
      ),
    } as never);

    const result = await withActivityTransaction(async (innerTx) => {
      await appendActivityEvent(innerTx, { ...validInput });
      committed.push("domain-write");
      return "done";
    });

    expect(result).toBe("done");
    expect(committed).toEqual(["domain-write"]);
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("schedules the blocked alert only after the transaction rolls back", async () => {
    const order: string[] = [];
    const committed: string[] = [];
    const tx = makeTx({
      returningRows: [],
      insertError: Object.assign(new Error("db down"), { code: "08006" }),
    });
    scheduleSpy.mockImplementation(() => {
      order.push("alert");
    });
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
        const staged: string[] = [];
        try {
          const result = await work(
            Object.assign(tx, { staged }),
          );
          committed.push(...staged);
          return result;
        } catch (error) {
          staged.length = 0;
          order.push("rollback");
          throw error;
        }
      }),
    } as never);

    const error = await withActivityTransaction(async (innerTx) => {
      (innerTx as unknown as { staged: string[] }).staged.push("domain-write");
      await appendActivityEvent(innerTx, { ...validInput });
      return "done";
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActivityWriteError);
    expect((error as ActivityWriteError).failureCategory).toBe("connection");
    expect(committed).toEqual([]);
    expect(order).toEqual(["rollback", "alert"]);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy.mock.calls[0][0]).toBe(error);
  });

  it("does not alert for generic work or commit failures", async () => {
    const tx = makeTx({ returningRows: [{ id: "evt-1" }] });
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
        work(tx),
      ),
    } as never);

    await expect(
      withActivityTransaction(async () => {
        throw new Error("domain failure");
      }),
    ).rejects.toThrow("domain failure");
    expect(scheduleSpy).not.toHaveBeenCalled();

    vi.mocked(dbModule.getDb).mockReturnValue({
      transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
        await work(tx);
        throw new Error("commit failed");
      }),
    } as never);

    await expect(
      withActivityTransaction(async () => "done"),
    ).rejects.toThrow("commit failed");
    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});

describe("reportActivityRollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules only typed activity errors", () => {
    const writeError = new ActivityWriteError({
      eventKey: "thp.submitted",
      failureCategory: "constraint",
      sqlState: "23505",
    });
    reportActivityRollback(writeError);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(writeError);

    reportActivityRollback(new Error("generic"));
    reportActivityRollback("string failure");
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });
});
