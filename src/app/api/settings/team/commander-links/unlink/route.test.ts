import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionIdMock = vi.fn();
const loadSessionMock = vi.fn();
const ensureCurrentAllianceForSessionMock = vi.fn();
const getRbacContextMock = vi.fn();
const sessionHasMembershipForAllianceMock = vi.fn();
const unlinkCommanderHqAccountMock = vi.fn();
const unlinkCommanderDiscordLinksMock = vi.fn();

vi.mock("@/lib/session", () => ({
  readSessionId: () => readSessionIdMock(),
  loadSession: (sessionId: string) => loadSessionMock(sessionId),
  ensureCurrentAllianceForSession: (session: unknown) =>
    ensureCurrentAllianceForSessionMock(session),
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: (session: {
    currentAllianceId?: string | null;
    allianceId?: string | null;
  }) => session.currentAllianceId ?? session.allianceId ?? null,
  sessionHasMembershipForAlliance: (hqUserId: string, allianceId: string) =>
    sessionHasMembershipForAllianceMock(hqUserId, allianceId),
}));

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext: (sessionId: string) => getRbacContextMock(sessionId),
}));

vi.mock("@/lib/member-link/unlink.server", () => ({
  unlinkCommanderHqAccount: (input: unknown) =>
    unlinkCommanderHqAccountMock(input),
  unlinkCommanderDiscordLinks: (input: unknown) =>
    unlinkCommanderDiscordLinksMock(input),
}));

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("https://example.test/api/settings/team/commander-links/unlink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const session = {
  id: "sess-1",
  hqUserId: "actor-1",
  currentAllianceId: "alliance-1",
};

function mockRbac(partial: {
  isPlatformMaintainer?: boolean;
  roleName?: string | null;
} = {}) {
  getRbacContextMock.mockResolvedValue({
    sessionId: "sess-1",
    hqUserId: "actor-1",
    email: "owner@example.test",
    displayName: null,
    avatarUrl: null,
    isPlatformMaintainer: false,
    currentAllianceId: "alliance-1",
    roleName: "owner",
    permissions: new Set(),
    ...partial,
  });
}

describe("POST /api/settings/team/commander-links/unlink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionIdMock.mockResolvedValue("sess-1");
    loadSessionMock.mockResolvedValue(session);
    ensureCurrentAllianceForSessionMock.mockResolvedValue(session);
    sessionHasMembershipForAllianceMock.mockResolvedValue(true);
    unlinkCommanderHqAccountMock.mockResolvedValue({
      ok: true,
      target: "hq",
      removed: 1,
    });
    unlinkCommanderDiscordLinksMock.mockResolvedValue({
      ok: true,
      target: "discord",
      removed: 2,
    });
    mockRbac();
  });

  it("allows an alliance owner with active membership to unlink HQ binding", async () => {
    const res = await POST(jsonRequest({ ashedMemberId: "member-1", target: "hq" }));

    expect(res.status).toBe(200);
    expect(sessionHasMembershipForAllianceMock).toHaveBeenCalledWith(
      "actor-1",
      "alliance-1",
    );
    expect(unlinkCommanderHqAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorHqUserId: "actor-1",
        allianceId: "alliance-1",
        ashedMemberId: "member-1",
      }),
    );
  });

  it("blocks platform maintainers without active membership in the selected alliance", async () => {
    mockRbac({ isPlatformMaintainer: true, roleName: null });
    sessionHasMembershipForAllianceMock.mockResolvedValue(false);

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", target: "hq" }));

    expect(res.status).toBe(403);
    expect(unlinkCommanderHqAccountMock).not.toHaveBeenCalled();
    expect(unlinkCommanderDiscordLinksMock).not.toHaveBeenCalled();
  });

  it("allows platform maintainers with active membership to unlink Discord bindings", async () => {
    mockRbac({ isPlatformMaintainer: true, roleName: "viewer" });

    const res = await POST(
      jsonRequest({ ashedMemberId: "member-1", target: "discord" }),
    );

    expect(res.status).toBe(200);
    expect(unlinkCommanderDiscordLinksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorHqUserId: "actor-1",
        allianceId: "alliance-1",
        ashedMemberId: "member-1",
      }),
    );
  });

  it("blocks officers even when they have alliance membership", async () => {
    mockRbac({ roleName: "officer" });

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", target: "hq" }));

    expect(res.status).toBe(403);
    expect(sessionHasMembershipForAllianceMock).not.toHaveBeenCalled();
    expect(unlinkCommanderHqAccountMock).not.toHaveBeenCalled();
  });
});
