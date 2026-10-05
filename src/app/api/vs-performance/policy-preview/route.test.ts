import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";

const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), external: vi.fn(), compute: vi.fn(), insert: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/vs-compliance/access.server", () => ({ requireVsComplianceAccess: mocks.access }));
vi.mock("@/lib/vs-compliance/evidence.server", () => ({ prepareExternalEvidence: mocks.external }));
vi.mock("@/lib/vs-compliance/repository.server", () => ({ computeComplianceRows: mocks.compute }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return { schema, getDb: () => ({ insert: mocks.insert, update: mocks.update, transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ insert: mocks.insert, update: mocks.update }) }) };
});
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
import { POST } from "./route";

const request = (body: unknown) => new Request("https://example.test/api/vs-performance/policy-preview", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const closedWeek = lastClosedVsWeek(new Date());
const patch = { enabled: true, dailyTarget: 7_200_000, allowedMissedDays: 0, demotion: { unit: "weeks", length: 1 }, promotion: { unit: "weeks", length: 2 } };
const rows = [{
  memberId: "member", memberName: "Member", weekEnding: closedWeek,
  memberSnapshot: { currentRank: 3 },
  evaluation: { outcome: "missed", counts: { required: 6, met: 0, missed: 6, excused: 0, unknown: 0 }, recommendation: { kind: "demote", targetRank: 2 }, signal: { kind: "concern", targetRank: null, reached: false }, days: [{ date: "2026-01-01", assessment: "missed", score: 0 }], evaluationBasis: "secret", sequence: { demotion: { episode: { units: ["2026-01-01"] } } } },
}, {
  memberId: "member", memberName: "Member", weekEnding: "1999-01-03",
  memberSnapshot: { currentRank: 3 },
  evaluation: { outcome: "passed", counts: { required: 6, met: 6, missed: 0, excused: 0, unknown: 0 }, recommendation: { kind: "none", targetRank: null }, signal: { kind: "none", targetRank: null, reached: false } },
}];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "session", hqUserId: "user", currentAllianceId: "tenant" });
  mocks.access.mockResolvedValue({ hqUserId: "user" });
  mocks.external.mockResolvedValue({ native: true, verifiedAt: null, weeks: new Map(), excuses: [] });
  mocks.compute.mockResolvedValue({ rows });
});

describe("v2 policy preview route", () => {
  it("returns only the requested week and never performs a write", async () => {
    const response = await POST(request({ policy: patch, weekEnding: closedWeek }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weekEnding).toBe(closedWeek);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toEqual({ memberId: "member", memberName: "Member", currentRank: 3, outcome: "missed", counts: { required: 6, met: 0, missed: 6, excused: 0, unknown: 0 }, recommendationKind: "demote", signal: { kind: "concern", targetRank: null, reached: false } });
    expect(mocks.access).toHaveBeenCalledWith("session", "tenant", "vs_compliance:settings");
    expect(mocks.external).toHaveBeenCalledWith("tenant", [closedWeek]);
    expect(mocks.compute).toHaveBeenCalledTimes(1);
    const [, allianceArg, weeksArg, , optionsArg] = mocks.compute.mock.calls[0];
    expect(allianceArg).toBe("tenant");
    expect(weeksArg.at(-1)).toBe(closedWeek);
    expect(optionsArg.policiesOverride).toHaveLength(1);
    expect(optionsArg.policiesOverride[0]).toMatchObject({ modelVersion: 2, version: 1, enabled: true, allowedMissedDays: 0, demotion: { unit: "weeks", length: 1 } });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects anonymous sessions and non-officers before reading evidence", async () => {
    mocks.session.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(request({ policy: patch, weekEnding: closedWeek }))).status).toBe(401);
    mocks.session.mockResolvedValue({ id: "session", hqUserId: null, currentAllianceId: "tenant" });
    expect((await POST(request({ policy: patch, weekEnding: closedWeek }))).status).toBe(403);
    mocks.session.mockResolvedValue({ id: "session", hqUserId: "user", currentAllianceId: "tenant" });
    mocks.access.mockRejectedValue(new (await import("@/lib/vs-compliance/types.shared")).VsComplianceError("forbidden", 403));
    expect((await POST(request({ policy: patch, weekEnding: closedWeek }))).status).toBe(403);
    expect(mocks.external).not.toHaveBeenCalled();
    expect(mocks.compute).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies, legacy patches, and open weeks", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request({ policy: patch }))).status).toBe(400);
    expect((await POST(request({ policy: { enabled: true, weeklyMinimum: 40_000_000 }, weekEnding: closedWeek }))).status).toBe(400);
    expect((await POST(request({ policy: patch, weekEnding: "2999-01-03" }))).status).toBe(400);
    expect(mocks.compute).not.toHaveBeenCalled();
  });
});
