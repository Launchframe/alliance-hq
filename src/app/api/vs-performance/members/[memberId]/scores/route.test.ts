import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { VsEvidenceError } from "@/lib/vs-scores/evidence.shared";

const mocks = vi.hoisted(() => ({ session: vi.fn(), save: vi.fn(), sync: vi.fn(), afterCallbacks: [] as Array<() => Promise<void>> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/vs-performance/member-score-edit.server", () => ({ saveManualVsScores: mocks.save }));
vi.mock("@/lib/vs-scores/sync.server", () => ({ syncVsScoresForAlliance: mocks.sync }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => `t:${key}` }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => Promise<void>) => mocks.afterCallbacks.push(callback),
  };
});
import { PATCH } from "./route";

const request = (body: unknown = { weekStart: "2020-01-06" }) =>
  new Request("https://example.test/api/vs-performance/members/m-1/scores", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === null ? "not-json{" : JSON.stringify(body),
  });
const context = { params: Promise.resolve({ memberId: "m-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.session.mockResolvedValue({ id: "session", hqUserId: "user", currentAllianceId: "tenant" });
  mocks.save.mockResolvedValue({ ok: true, changed: 2, syncStatus: "local", replayed: false });
});

describe("member score edit route", () => {
  it("passes the raw body to the service and schedules sync after a new save", async () => {
    const response = await PATCH(request({ weekStart: "2020-01-06" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: 2, syncStatus: "local", replayed: false });
    expect(mocks.save).toHaveBeenCalledWith("session", "tenant", "m-1", { weekStart: "2020-01-06" });
    expect(mocks.afterCallbacks).toHaveLength(1);
    mocks.sync.mockRejectedValue(new Error("ashed down"));
    await mocks.afterCallbacks[0]!();
    expect(mocks.sync).toHaveBeenCalledWith("tenant");
  });

  it("does not schedule sync for a replayed receipt", async () => {
    mocks.save.mockResolvedValue({ ok: true, changed: 2, syncStatus: "local", replayed: true });
    const response = await PATCH(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("denies anonymous and alliance-less sessions before any save", async () => {
    mocks.session.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await PATCH(request(), context)).status).toBe(401);
    mocks.session.mockResolvedValue({ id: "s", hqUserId: "user", currentAllianceId: null, allianceId: null });
    expect((await PATCH(request(), context)).status).toBe(403);
    mocks.session.mockResolvedValue({ id: "s", hqUserId: null, currentAllianceId: "tenant" });
    expect((await PATCH(request(), context)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("maps service errors to approved copy without echoing internals", async () => {
    const cases: Array<[unknown, number, string]> = [
      [new VsEvidenceError("stale", 409), 409, "t:vsPerformance.member.scoreChanged"],
      [new VsComplianceError("changed", 409), 409, "t:vsPerformance.member.scoreChanged"],
      [new VsComplianceError("handled", 409), 409, "t:vsPerformance.member.scoreChanged"],
      [new VsEvidenceError("invalid_score"), 400, "t:vsPerformance.member.scoreInvalid"],
      [new VsEvidenceError("invalid_rows"), 400, "t:vsPerformance.member.scoreInvalid"],
      [new VsEvidenceError("invalid_period"), 400, "t:vsPerformance.member.futureDay"],
      [new VsEvidenceError("forbidden", 403), 403, "t:vsPerformance.errors.forbidden"],
      [new VsComplianceError("forbidden", 403), 403, "t:vsPerformance.errors.forbidden"],
      [new VsComplianceError("not_found", 404), 404, "t:vsPerformance.member.notFound"],
      [new Error("db exploded with secret"), 500, "t:vsPerformance.errors.save"],
    ];
    for (const [error, status, text] of cases) {
      mocks.save.mockRejectedValueOnce(error);
      const response = await PATCH(request(), context);
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error).toBe(text);
      expect(body.error).not.toContain("secret");
    }
  });

  it("treats malformed JSON as an invalid payload", async () => {
    const response = await PATCH(request(null), context);
    expect(mocks.save).toHaveBeenCalledWith("session", "tenant", "m-1", null);
    expect(response.status).toBe(200);
  });
});
