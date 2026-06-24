import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const readSessionIdMock = vi.fn();
const loadSessionMock = vi.fn();
const clearSessionAllianceContextMock = vi.fn();
const saveHqMemberLinkPendingMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/session", () => ({
  readSessionId: () => readSessionIdMock(),
  loadSession: (sessionId: string) => loadSessionMock(sessionId),
  clearSessionAllianceContext: (sessionId: string) =>
    clearSessionAllianceContextMock(sessionId),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  saveHqMemberLinkPending: (
    allianceId: string,
    hqUserId: string,
    pending: null,
  ) => saveHqMemberLinkPendingMock(allianceId, hqUserId, pending),
}));

import { POST } from "./route";

describe("POST /api/onboarding/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionAllianceContextMock.mockResolvedValue(undefined);
    saveHqMemberLinkPendingMock.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 400 when browser session cookie is missing", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    readSessionIdMock.mockResolvedValue(undefined);

    const res = await POST();
    expect(res.status).toBe(400);
  });

  it("returns 403 when browser session belongs to another HQ user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    readSessionIdMock.mockResolvedValue("sess-1");
    loadSessionMock.mockResolvedValue({
      id: "sess-1",
      hqUserId: "other-user",
      allianceId: "ally-1",
    });

    const res = await POST();
    expect(res.status).toBe(403);
    expect(clearSessionAllianceContextMock).not.toHaveBeenCalled();
  });

  it("clears pending member link and alliance context for the signed-in user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    readSessionIdMock.mockResolvedValue("sess-1");
    loadSessionMock.mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-1",
      currentAllianceId: "ally-1",
    });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(saveHqMemberLinkPendingMock).toHaveBeenCalledWith(
      "ally-1",
      "user-1",
      null,
    );
    expect(clearSessionAllianceContextMock).toHaveBeenCalledWith("sess-1");
  });

  it("allows legacy sessions without hqUserId binding", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    readSessionIdMock.mockResolvedValue("sess-1");
    loadSessionMock.mockResolvedValue({
      id: "sess-1",
      hqUserId: null,
      allianceId: "ally-2",
    });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(saveHqMemberLinkPendingMock).toHaveBeenCalledWith(
      "ally-2",
      "user-1",
      null,
    );
    expect(clearSessionAllianceContextMock).toHaveBeenCalledWith("sess-1");
  });

  it("clears alliance context when session row is expired or missing", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    readSessionIdMock.mockResolvedValue("sess-1");
    loadSessionMock.mockResolvedValue(null);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(saveHqMemberLinkPendingMock).not.toHaveBeenCalled();
    expect(clearSessionAllianceContextMock).toHaveBeenCalledWith("sess-1");
  });
});
