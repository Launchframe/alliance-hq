import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const session = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
import { complianceApiContext, complianceErrorResponse } from "./routes.server";
import { VsComplianceError } from "./types.shared";

beforeEach(() => { vi.clearAllMocks(); });
describe("compliance API boundaries and safe errors", () => {
  it("preserves no-cookie rejection and refuses bootstrap or unscoped principals", async () => {
    session.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect(await complianceApiContext()).toBeInstanceOf(NextResponse);
    for (const value of [{ id: "bootstrap", hqUserId: null, currentAllianceId: "tenant" }, { id: "session", hqUserId: "user", currentAllianceId: null, allianceId: null }]) {
      session.mockResolvedValue(value);
      await expect(complianceApiContext()).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }
  });
  it("uses the selected tenant without accepting an alliance id from request data", async () => {
    session.mockResolvedValue({ id: "session", hqUserId: "user", currentAllianceId: "selected", allianceId: "old" });
    expect(await complianceApiContext()).toEqual({ sessionId: "session", allianceId: "selected" });
  });
  it("maps transaction serialization/deadlock conflicts to a recoverable 409 without SQL details", async () => {
    const response = await complianceErrorResponse({ message: "private statement", cause: { code: "40001", detail: "private evidence" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "changed", error: "vsCompliance.changed" });
  });
  it("localizes waiver, handled and authorization errors without exposing private error messages", async () => {
    for (const error of [new VsComplianceError("reason_required"), new VsComplianceError("handled", 409), new VsComplianceError("forbidden", 403)]) {
      expect((await complianceErrorResponse(error)).status).toBe(error.status);
    }
    const response = await complianceErrorResponse(new Error("private backend details"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private backend details");
  });
});
