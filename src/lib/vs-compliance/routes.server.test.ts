import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const session = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => vi.fn());
const reads = vi.hoisted(() => ({ dashboard: vi.fn(), history: vi.fn() }));
vi.mock("./service.server", () => ({ loadComplianceDashboard: reads.dashboard }));
vi.mock("./history.server", () => ({ loadComplianceHistory: reads.history }));
vi.mock("./access.server", () => ({ requireVsComplianceAccess: access }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: session }));
const page = vi.hoisted(() => ({ auth: vi.fn(), redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/auth/page-guard", () => ({ requireAuthForPage: page.auth }));
vi.mock("@/i18n/navigation", () => ({ redirect: page.redirect }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key, getLocale: async () => "pt-BR" }));
import { complianceApiContext, complianceErrorResponse } from "./routes.server";
import { VsComplianceError } from "./types.shared";
import { GET } from "@/app/api/vs-compliance/route";
import LegacyVsComplianceSettingsPage from "@/app/[locale]/(app)/settings/vs-compliance/page";

beforeEach(() => { vi.clearAllMocks(); });
describe("compliance API boundaries and safe errors", () => {
  it("redirects the legacy page only after authentication, preserving locale and destination guards", async () => {
    await expect(LegacyVsComplianceSettingsPage()).rejects.toThrow("redirect");
    expect(page.auth).toHaveBeenCalledWith("/settings/vs-membership-minimums");
    expect(page.redirect).toHaveBeenCalledWith({ href: "/settings/vs-membership-minimums", locale: "pt-BR" });
    expect(session).not.toHaveBeenCalled();
  });
  it("does not send anonymous legacy visitors to a bootstrap-capable destination", async () => {
    page.auth.mockRejectedValueOnce(new Error("auth-required"));
    await expect(LegacyVsComplianceSettingsPage()).rejects.toThrow("auth-required");
    expect(page.redirect).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });
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
    expect(access).toHaveBeenCalledWith("session", "selected", "vs_compliance:read");
  });
  it("routes history reads by event under current-tenant VS_READ without rebuilding or refreshing sources", async () => {
    session.mockResolvedValue({ id: "session", hqUserId: "user", currentAllianceId: "selected", allianceId: "old" });
    reads.history.mockResolvedValue({ eventId: "event", actions: [] });
    const response = await GET(new Request("https://hq.test/api/vs-compliance?eventId=event&allianceId=foreign"));
    expect(response.status).toBe(200);
    expect(reads.history).toHaveBeenCalledWith("session", "selected", "event");
    expect(access).toHaveBeenCalledWith("session", "selected", "vs_compliance:read");
    expect(reads.dashboard).not.toHaveBeenCalled();
  });
  it("rejects unauthorized history before invoking its reader", async () => {
    session.mockResolvedValue({ id: "session", hqUserId: "member", currentAllianceId: "selected" });
    access.mockRejectedValueOnce(new VsComplianceError("forbidden", 403));
    expect((await GET(new Request("https://hq.test/api/vs-compliance?eventId=private"))).status).toBe(403);
    expect(reads.history).not.toHaveBeenCalled();
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
