import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enUS from "../../../../../messages/en-US.json";
import ptBR from "../../../../../messages/pt-BR.json";

const mockRequireApiSession = vi.fn();
const mockRequireSessionPermission = vi.fn();
const mockGetActivityPrincipalForSession = vi.fn();
const mockHandleWebVrCommand = vi.fn();
const mockLoadMyVrForUser = vi.fn();
const mockGetTranslations = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => mockRequireApiSession(...args),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: (...args: unknown[]) =>
    mockRequireSessionPermission(...args),
}));

vi.mock("@/lib/activity/access.server", () => ({
  getActivityPrincipalForSession: (...args: unknown[]) =>
    mockGetActivityPrincipalForSession(...args),
}));

vi.mock("@/lib/vr/web-vr.server", () => ({
  handleWebVrCommand: (...args: unknown[]) => mockHandleWebVrCommand(...args),
  loadMyVrForUser: (...args: unknown[]) => mockLoadMyVrForUser(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: () => Promise.resolve("en-US"),
  getTranslations: (...args: unknown[]) => mockGetTranslations(...args),
}));

import { GET, POST } from "./route";

const SESSION = {
  id: "sess-1",
  hqUserId: "hq-1",
  currentAllianceId: "ally-1",
  allianceId: "ally-1",
  expiresAt: new Date(Date.now() + 60_000),
};

const PRINCIPAL = {
  hqUserId: "hq-1",
  sessionId: "sess-1",
  currentAllianceId: "ally-1",
  permissions: new Set(["members:read"]),
  isPlatformMaintainer: false,
  scopeFence: "",
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/vr/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function useCatalogTranslations(messages: typeof enUS) {
  mockGetTranslations.mockImplementation((namespace: string) =>
    Promise.resolve((key: string) => {
      const ns = messages[namespace as keyof typeof messages] as Record<
        string,
        string
      >;
      return ns[key];
    }),
  );
}

describe("POST /api/vr/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiSession.mockResolvedValue(SESSION);
    mockRequireSessionPermission.mockResolvedValue(null);
    mockGetActivityPrincipalForSession.mockResolvedValue(PRINCIPAL);
    mockHandleWebVrCommand.mockResolvedValue({
      status: "set_vr",
      message: "ok",
      newVr: 3400,
    });
    mockLoadMyVrForUser.mockResolvedValue({ linked: true });
    mockGetTranslations.mockImplementation(() =>
      Promise.resolve((key: string) => key),
    );
  });

  it("rejects anonymous requests", async () => {
    mockRequireApiSession.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(jsonRequest({ instituteLevel: 30 }));

    expect(res.status).toBe(401);
    expect(mockHandleWebVrCommand).not.toHaveBeenCalled();
  });

  it("rejects sessions without a verified activity principal", async () => {
    mockGetActivityPrincipalForSession.mockResolvedValue(null);

    const res = await POST(jsonRequest({ instituteLevel: 30 }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "accessChanged" });
    expect(mockHandleWebVrCommand).not.toHaveBeenCalled();
  });

  it("rejects a principal bound to another alliance", async () => {
    mockGetActivityPrincipalForSession.mockResolvedValue({
      ...PRINCIPAL,
      currentAllianceId: "other-alliance",
    });

    const res = await POST(jsonRequest({ instituteLevel: 30 }));

    expect(res.status).toBe(403);
    expect(mockHandleWebVrCommand).not.toHaveBeenCalled();
  });

  it("passes the verified principal on submissions", async () => {
    const res = await POST(jsonRequest({ instituteLevel: 30 }));

    expect(res.status).toBe(200);
    expect(mockHandleWebVrCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        allianceId: "ally-1",
        hqUserId: "hq-1",
        principal: PRINCIPAL,
        locale: "en-US",
        explicitInstituteLevel: 30,
      }),
    );
  });

  it("passes the verified principal on confirmations", async () => {
    const res = await POST(jsonRequest({ confirm: "yes" }));

    expect(res.status).toBe(200);
    expect(mockHandleWebVrCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: PRINCIPAL,
        confirm: "yes",
      }),
    );
  });

  for (const [locale, messages] of [
    ["en-US", enUS],
    ["pt-BR", ptBR],
  ] as const) {
    it(`returns the localized alliance-required error on GET without an alliance (${locale})`, async () => {
      useCatalogTranslations(messages);
      mockRequireApiSession.mockResolvedValue({
        ...SESSION,
        currentAllianceId: null,
        allianceId: null,
      });

      const res = await GET();

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: messages.settings.allianceRequired,
      });
      expect(mockLoadMyVrForUser).not.toHaveBeenCalled();
    });

    it(`returns the localized link-required error on GET without a member link (${locale})`, async () => {
      useCatalogTranslations(messages);
      mockLoadMyVrForUser.mockResolvedValue(null);

      const res = await GET();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        code: "member_link_required",
        error: messages.professions.linkRequired,
      });
    });

    it(`returns the localized alliance-required error on POST without an alliance (${locale})`, async () => {
      useCatalogTranslations(messages);
      mockRequireApiSession.mockResolvedValue({
        ...SESSION,
        currentAllianceId: null,
        allianceId: null,
      });

      const res = await POST(jsonRequest({ instituteLevel: 30 }));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: messages.settings.allianceRequired,
      });
      expect(mockHandleWebVrCommand).not.toHaveBeenCalled();
    });

    it(`returns the localized link-required error on POST without a member link (${locale})`, async () => {
      useCatalogTranslations(messages);
      mockHandleWebVrCommand.mockResolvedValue({
        code: "member_link_required",
      });

      const res = await POST(jsonRequest({ instituteLevel: 30 }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        code: "member_link_required",
        error: messages.professions.linkRequired,
      });
    });
  }
});
