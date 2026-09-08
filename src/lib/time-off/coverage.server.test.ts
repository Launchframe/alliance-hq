import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDutyCoverage, CoverageConflictError, findCoverageConflicts, withCoverageActor } from "./coverage.server";
import type { AvailabilityTransaction } from "./availability.server";

const duty = { assignmentId: "assignment", assignmentVersion: "10", dutyDate: "2026-09-10", dutyRole: "conductor" as const, memberId: "member", memberName: "Commander", lockedAt: null };
let notices: Array<{ id: string; version: number }> = [];
const audit = vi.fn();
const tx = {
  select: () => ({ from: () => ({ where: async () => notices }) }),
  insert: () => ({ values: (row: unknown) => { audit(row); return { onConflictDoNothing: async () => undefined }; } }),
} as unknown as AvailabilityTransaction;

describe("transaction-local coverage guard", () => {
  beforeEach(() => { notices = [{ id: "notice", version: 1 }]; audit.mockClear(); });
  it("rejects unconfirmed automated or manual assignments without independent DB helpers", async () => {
    await expect(assertDutyCoverage(tx, "alliance", [duty])).rejects.toBeInstanceOf(CoverageConflictError);
    expect(audit).not.toHaveBeenCalled();
  });
  it("accepts available members without inventing an audit override", async () => {
    notices = [];
    await assertDutyCoverage(tx, "alliance", [duty]);
    expect(audit).not.toHaveBeenCalled();
  });
  it("binds the confirmed assignment to actor and idempotency and never stores absence details", async () => {
    const conflicts = await findCoverageConflicts(tx, "alliance", [duty]);
    await withCoverageActor({ allianceId: "alliance", hqUserId: "officer", acceptance: { conflicts, note: "Coverage confirmed", requestId: "request_1234567890" } }, () => assertDutyCoverage(tx, "alliance", [duty]));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ hqUserId: "officer", metadata: expect.objectContaining({ conflicts, note: "Coverage confirmed", requestId: "request_1234567890" }) }));
    expect(JSON.stringify(audit.mock.calls)).not.toContain('"notice"');
  });
  it("invalidates accepted versions when a notice changes", async () => {
    const conflicts = await findCoverageConflicts(tx, "alliance", [duty]);
    notices[0]!.version++;
    await expect(withCoverageActor({ allianceId: "alliance", hqUserId: "officer", acceptance: { conflicts, note: "Confirmed", requestId: "request_1234567890" } }, () => assertDutyCoverage(tx, "alliance", [duty]))).rejects.toBeInstanceOf(CoverageConflictError);
    expect(audit).not.toHaveBeenCalled();
  });
  it("rejects cross-alliance and anonymous acceptance", async () => {
    const conflicts = await findCoverageConflicts(tx, "alliance", [duty]);
    const acceptance = { conflicts, note: "Confirmed", requestId: "request_1234567890" };
    for (const actor of [{ allianceId: "other", hqUserId: "officer", acceptance }, { allianceId: "alliance", acceptance }]) {
      await expect(withCoverageActor(actor, () => assertDutyCoverage(tx, "alliance", [duty]))).rejects.toBeInstanceOf(CoverageConflictError);
    }
    expect(audit).not.toHaveBeenCalled();
  });
  it("hashes all overlapping notice revisions independent of query order", async () => {
    notices.push({ id: "another", version: 2 });
    const before = await findCoverageConflicts(tx, "alliance", [duty]);
    notices.reverse();
    expect(await findCoverageConflicts(tx, "alliance", [duty])).toEqual(before);
    notices.pop();
    expect(await findCoverageConflicts(tx, "alliance", [duty])).not.toEqual(before);
  });
});
