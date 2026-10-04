import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), results: [] as unknown[][], select: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./access.server", () => ({ requireVsComplianceAccess: mocks.access }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const chain = (rows: unknown[]) => { const value = Object.assign(Promise.resolve(rows), { from: () => value, where: () => value, orderBy: () => value, limit: () => value, leftJoin: () => value }); return value; };
  return { schema, getDb: () => ({ select: (...args: unknown[]) => { mocks.select(...args); return chain(mocks.results.shift() ?? []); } }) };
});
import { loadComplianceHistory } from "./history.server";
import { VsComplianceError } from "./types.shared";

beforeEach(() => { vi.clearAllMocks(); mocks.results = []; mocks.access.mockResolvedValue({ hqUserId: "viewer" }); });
describe("immutable discipline history read DTO", () => {
  it.each(["member", "data_entry", "anonymous"])("denies %s before querying private history", async () => {
    mocks.access.mockRejectedValue(new VsComplianceError("forbidden", 403));
    await expect(loadComplianceHistory("session", "tenant", "event")).rejects.toMatchObject({ status: 403 });
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("returns not found for an event outside the current tenant", async () => {
    mocks.results = [[]];
    await expect(loadComplianceHistory("session", "tenant", "foreign-event")).rejects.toMatchObject({ status: 404 });
    expect(mocks.access).toHaveBeenCalledWith("session", "tenant", "vs_compliance:read");
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
  it("allowlists original attribution and private waiver reason only in the guarded detail", async () => {
    const action = { id: "action", actorId: "original-officer", actorName: "Original Officer", kind: "waive", expectedRank: 3, targetRank: null, reason: "Private waiver", recordedAt: new Date("2026-09-14T02:00:00Z"), syncStatus: null, supersededAt: null, requestId: "private-request", memberSnapshot: { rankVersion: "private" } };
    const original = structuredClone(action);
    mocks.results = [[{ id: "event", memberId: "member", memberName: "Commander", weekEnding: "2026-09-13", correctionReview: true }], [action], [{ actionId: "action", recordedAt: new Date("2026-09-15T02:00:00Z") }]];
    const result = await loadComplianceHistory("session", "tenant", "event");
    expect(result).toMatchObject({ eventId: "event", weekEnding: "2026-09-13", actions: [{ actorId: "original-officer", actorName: "Original Officer", reason: "Private waiver", recordedAt: "2026-09-14T02:00:00.000Z", correctionReview: true, reviewDates: ["2026-09-15T02:00:00.000Z"] }] });
    expect(JSON.stringify(result)).not.toContain("private-request");
    expect(JSON.stringify(result)).not.toContain("memberSnapshot");
    expect(action).toEqual(original);
  });
});
