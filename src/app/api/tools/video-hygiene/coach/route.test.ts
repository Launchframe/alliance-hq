import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const requireSessionPermissionMock = vi.fn();
const resolveVideoHygieneCoachTipMock = vi.fn();
const pickVideoHygieneCoachTipForUploaderMock = vi.fn();
const recordCoachShownMock = vi.fn();
const recordCoachDismissedMock = vi.fn();
const resolveSessionAllianceIdMock = vi.fn();
const getScoreTargetMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: () => requireApiSessionMock(),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: (...args: unknown[]) =>
    requireSessionPermissionMock(...args),
}));

vi.mock("@/lib/video/video-hygiene-coach.server", () => ({
  resolveVideoHygieneCoachTip: (...args: unknown[]) =>
    resolveVideoHygieneCoachTipMock(...args),
  pickVideoHygieneCoachTipForUploader: (...args: unknown[]) =>
    pickVideoHygieneCoachTipForUploaderMock(...args),
  recordCoachShown: (...args: unknown[]) => recordCoachShownMock(...args),
  recordCoachDismissed: (...args: unknown[]) =>
    recordCoachDismissedMock(...args),
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: (...args: unknown[]) =>
    resolveSessionAllianceIdMock(...args),
}));

vi.mock("@/lib/video/score-targets", () => ({
  getScoreTarget: (id: string) => getScoreTargetMock(id),
}));

import { GET, POST } from "./route";

const SESSION = {
  id: "sess-1",
  hqUserId: "user-1",
};

describe("GET /api/tools/video-hygiene/coach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(SESSION);
    requireSessionPermissionMock.mockResolvedValue(null);
    getScoreTargetMock.mockReturnValue({ id: "desert-storm" });
  });

  it("returns null tip when session has no hq user", async () => {
    requireApiSessionMock.mockResolvedValue({ id: "sess-1", hqUserId: null });

    const res = await GET(
      new Request(
        "http://localhost/api/tools/video-hygiene/coach?scoreTarget=desert-storm",
      ),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ tip: null });
    expect(requireSessionPermissionMock).not.toHaveBeenCalled();
  });

  it("enforces video enqueue permission", async () => {
    const forbidden = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
    });
    requireSessionPermissionMock.mockResolvedValue(forbidden);

    const res = await GET(
      new Request(
        "http://localhost/api/tools/video-hygiene/coach?scoreTarget=desert-storm",
      ),
    );

    expect(res.status).toBe(403);
    expect(resolveVideoHygieneCoachTipMock).not.toHaveBeenCalled();
  });

  it("returns resolved tip for authorized uploader", async () => {
    resolveVideoHygieneCoachTipMock.mockResolvedValue({
      tipId: "fastScroll",
      scoreTarget: "desert-storm",
      jobCount: 4,
    });

    const res = await GET(
      new Request(
        "http://localhost/api/tools/video-hygiene/coach?scoreTarget=desert-storm",
      ),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      tip: {
        tipId: "fastScroll",
        scoreTarget: "desert-storm",
        jobCount: 4,
      },
    });
    expect(resolveVideoHygieneCoachTipMock).toHaveBeenCalledWith({
      hqUserId: "user-1",
      scoreTarget: "desert-storm",
    });
  });
});

describe("POST /api/tools/video-hygiene/coach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(SESSION);
    requireSessionPermissionMock.mockResolvedValue(null);
    getScoreTargetMock.mockReturnValue({ id: "desert-storm" });
    resolveSessionAllianceIdMock.mockReturnValue("alliance-1");
    pickVideoHygieneCoachTipForUploaderMock.mockResolvedValue({
      tipId: "fastScroll",
      scoreTarget: "desert-storm",
      jobCount: 4,
    });
  });

  it("rejects shown events when tip no longer applies", async () => {
    pickVideoHygieneCoachTipForUploaderMock.mockResolvedValue({
      tipId: "chaoticScroll",
      scoreTarget: "desert-storm",
      jobCount: 4,
    });

    const res = await POST(
      new Request("http://localhost/api/tools/video-hygiene/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shown",
          scoreTarget: "desert-storm",
          tipId: "fastScroll",
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(recordCoachShownMock).not.toHaveBeenCalled();
  });

  it("records coach_shown for matching tip", async () => {
    const res = await POST(
      new Request("http://localhost/api/tools/video-hygiene/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shown",
          scoreTarget: "desert-storm",
          tipId: "fastScroll",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordCoachShownMock).toHaveBeenCalledWith({
      hqUserId: "user-1",
      scoreTarget: "desert-storm",
      tipId: "fastScroll",
      allianceId: "alliance-1",
    });
  });

  it("records coach_dismissed for matching tip", async () => {
    const res = await POST(
      new Request("http://localhost/api/tools/video-hygiene/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dismiss",
          scoreTarget: "desert-storm",
          tipId: "fastScroll",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordCoachDismissedMock).toHaveBeenCalledWith({
      hqUserId: "user-1",
      scoreTarget: "desert-storm",
      tipId: "fastScroll",
      allianceId: "alliance-1",
    });
  });
});
