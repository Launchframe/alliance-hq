import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

const mocks = vi.hoisted(() => ({ session: vi.fn(), resolve: vi.fn(), load: vi.fn(), save: vi.fn(), access: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/alliance/alliance-route-context.server", () => ({ resolveAllianceRouteForSession: mocks.resolve, AllianceRouteError: class extends Error {} }));
vi.mock("@/lib/vs-compliance/policy.server", () => ({ loadVsMembershipSettings: mocks.load, saveVsMembershipSettings: mocks.save }));
vi.mock("@/lib/vs-compliance/access.server", () => ({ requireVsComplianceAccess: mocks.access }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
import { GET, PATCH } from "./route";

const context = { params: Promise.resolve({ tag: "TAG" }) };
const request = () => new Request("https://example.test/api/alliance/TAG/vs-membership-minimums", { method: "PATCH", body: JSON.stringify({ expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000 }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "session", hqUserId: "user" });
  mocks.resolve.mockResolvedValue({ allianceId: "tenant", tag: "TAG", name: "Alliance" });
  mocks.load.mockResolvedValue({ latest: null, history: [] });
  mocks.save.mockResolvedValue({ version: 1 });
  mocks.access.mockResolvedValue({ hqUserId: "user" });
});

describe("native compliance policy route", () => {
  it("preserves no-cookie denial and never resolves an anonymous bootstrap principal", async () => {
    mocks.session.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await PATCH(request(), context)).status).toBe(401);
    mocks.session.mockResolvedValue({ id: "bootstrap", hqUserId: null });
    expect((await PATCH(request(), context)).status).toBe(403);
    expect((await GET(request(), context)).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("scopes both read and write to the server-resolved tenant, with no Ashed prerequisite", async () => {
    expect((await GET(request(), context)).status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith("session", "tenant");
    expect((await PATCH(request(), context)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("session", "tenant", { expectedVersion: 0, patch: { enabled: true, weeklyMinimum: 40_000_000 } });
  });

  it("does not expose settings to a member denied by the shared service", async () => {
    mocks.load.mockRejectedValue(new VsComplianceError("forbidden", 403));
    expect((await GET(request(), context)).status).toBe(403);
  });

  it("surfaces stale versions as a conflict and never leaks raw service errors", async () => {
    mocks.save.mockRejectedValue(new VsComplianceError("changed", 409));
    expect((await PATCH(request(), context)).status).toBe(409);
    mocks.save.mockRejectedValue(new Error("private database detail"));
    const response = await PATCH(request(), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });

  it("rejects malformed JSON before a mutation", async () => {
    const malformed = new Request(request(), { body: "{" });
    expect((await PATCH(malformed, context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
