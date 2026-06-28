import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { writeAuditLog } from "@/lib/bff/audit";

import {
  recordClaimConflict,
  resolveClaimConflict,
} from "./claim-conflict-queue.server";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn(),
}));

function selectReturning(result: unknown) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(result),
      }),
    }),
  };
}

describe("recordClaimConflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a new conflict when none is open for the tuple", async () => {
    let inserted: Record<string, unknown> | undefined;
    const insertValues = vi.fn((values: Record<string, unknown>) => {
      inserted = values;
      return Promise.resolve();
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => selectReturning([])),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    const id = await recordClaimConflict({
      allianceId: "alliance-1",
      ashedMemberId: "member-1",
      commanderName: "Maverick",
      hqUserId: "user-1",
      handle: "maverick@example.com",
      reason: "name_collision",
    });

    expect(id).toBeTruthy();
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(inserted?.allianceId).toBe("alliance-1");
    expect(inserted?.ashedMemberId).toBe("member-1");
    expect(inserted?.reason).toBe("name_collision");
    expect(inserted?.status).toBe("open");
  });

  it("updates the existing open conflict instead of inserting a duplicate", async () => {
    const updateWhere = vi.fn(() => Promise.resolve());
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const insertFn = vi.fn();
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => selectReturning([{ id: "conflict-1" }])),
      update: vi.fn(() => ({ set: updateSet })),
      insert: insertFn,
    } as never);

    const id = await recordClaimConflict({
      allianceId: "alliance-1",
      ashedMemberId: "member-1",
      commanderName: "Maverick",
      hqUserId: "user-1",
      handle: "maverick@example.com",
      reason: "name_collision",
    });

    expect(id).toBe("conflict-1");
    expect(insertFn).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledTimes(1);
  });
});

describe("resolveClaimConflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not_found when the conflict does not exist", async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => selectReturning([])),
    } as never);

    const result = await resolveClaimConflict({
      id: "missing",
      allianceId: "alliance-1",
      status: "resolved",
      resolvedByHqUserId: "user-1",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns forbidden when the conflict belongs to another alliance", async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() =>
        selectReturning([
          { id: "conflict-1", allianceId: "other", status: "open" },
        ]),
      ),
    } as never);

    const result = await resolveClaimConflict({
      id: "conflict-1",
      allianceId: "alliance-1",
      status: "resolved",
      resolvedByHqUserId: "user-1",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("returns not_open when the conflict is already resolved", async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() =>
        selectReturning([
          { id: "conflict-1", allianceId: "alliance-1", status: "resolved" },
        ]),
      ),
    } as never);

    const result = await resolveClaimConflict({
      id: "conflict-1",
      allianceId: "alliance-1",
      status: "dismissed",
      resolvedByHqUserId: "user-1",
    });

    expect(result).toEqual({ ok: false, reason: "not_open" });
  });

  it("updates the row and writes an audit log on success", async () => {
    const updateReturning = vi.fn(() => Promise.resolve([{ id: "conflict-1" }]));
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() =>
        selectReturning([
          {
            id: "conflict-1",
            allianceId: "alliance-1",
            status: "open",
            ashedMemberId: "member-1",
            reason: "commander_taken",
          },
        ]),
      ),
      update: vi.fn(() => ({ set: updateSet })),
    } as never);

    const result = await resolveClaimConflict({
      id: "conflict-1",
      allianceId: "alliance-1",
      status: "resolved",
      resolvedByHqUserId: "user-1",
      sessionId: "session-1",
    });

    expect(result).toEqual({ ok: true });
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateReturning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(writeAuditLog).mock.calls[0];
    expect(auditCall?.[0].action).toBe("member_link.claim_conflict_resolved");
  });

  it("does not audit when another reviewer already closed the conflict", async () => {
    const updateReturning = vi.fn(() => Promise.resolve([]));
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() =>
        selectReturning([
          {
            id: "conflict-1",
            allianceId: "alliance-1",
            status: "open",
            ashedMemberId: "member-1",
            reason: "name_collision",
          },
        ]),
      ),
      update: vi.fn(() => ({ set: updateSet })),
    } as never);

    const result = await resolveClaimConflict({
      id: "conflict-1",
      allianceId: "alliance-1",
      status: "dismissed",
      resolvedByHqUserId: "user-1",
      sessionId: "session-1",
    });

    expect(result).toEqual({ ok: false, reason: "not_open" });
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });
});
