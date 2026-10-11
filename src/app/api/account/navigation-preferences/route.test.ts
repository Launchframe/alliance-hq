import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const isFavoriteableDestinationMock = vi.fn();
const toggleNavigationFavoriteMock = vi.fn();
const setShowAshedPagesMock = vi.fn();
const recordNavigationVisitMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: () => requireApiSessionMock(),
}));

vi.mock("@/lib/nav/preferences.server", () => ({
  isFavoriteableDestination: (id: string) => isFavoriteableDestinationMock(id),
  loadNavigationPreferences: vi.fn(),
  toggleNavigationFavorite: (hqUserId: string, id: string) =>
    toggleNavigationFavoriteMock(hqUserId, id),
  setShowAshedPages: (hqUserId: string, value: boolean) =>
    setShowAshedPagesMock(hqUserId, value),
  recordNavigationVisit: (hqUserId: string, id: string) =>
    recordNavigationVisitMock(hqUserId, id),
}));

import { GET, PATCH, POST, PUT } from "./route";

function jsonRequest(method: string, body: string): Request {
  return new Request("http://localhost/api/account/navigation-preferences", {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("/api/account/navigation-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({ hqUserId: "hq-user-1" });
    isFavoriteableDestinationMock.mockReturnValue(true);
    toggleNavigationFavoriteMock.mockResolvedValue({ isFavorite: true });
  });

  it("returns 401 when the session has no HQ user", async () => {
    requireApiSessionMock.mockResolvedValue({ hqUserId: null });

    const res = await POST(jsonRequest("POST", '{"destinationId":"members"}'));
    expect(res.status).toBe(401);
    expect(toggleNavigationFavoriteMock).not.toHaveBeenCalled();
  });

  it("GET returns 401 when the session has no HQ user", async () => {
    requireApiSessionMock.mockResolvedValue({ hqUserId: null });

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("PUT returns 400 for an unknown destination", async () => {
    isFavoriteableDestinationMock.mockReturnValue(false);

    const res = await PUT(jsonRequest("PUT", '{"destinationId":"nope"}'));
    expect(res.status).toBe(400);
    expect(recordNavigationVisitMock).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", POST],
    ["PATCH", PATCH],
    ["PUT", PUT],
  ] as const)("%s returns 400 for a malformed JSON body", async (method, handler) => {
    const res = await handler(jsonRequest(method, "{not json"));
    expect(res.status).toBe(400);
  });

  it("POST returns 400 for an unknown destination", async () => {
    isFavoriteableDestinationMock.mockReturnValue(false);

    const res = await POST(jsonRequest("POST", '{"destinationId":"nope"}'));
    expect(res.status).toBe(400);
    expect(toggleNavigationFavoriteMock).not.toHaveBeenCalled();
  });

  it("rejects oversized destination ids", async () => {
    const body = JSON.stringify({ destinationId: "x".repeat(129) });

    expect((await POST(jsonRequest("POST", body))).status).toBe(400);
    expect((await PUT(jsonRequest("PUT", body))).status).toBe(400);
    expect(recordNavigationVisitMock).not.toHaveBeenCalled();
  });

  it("POST toggles a favoriteable destination for the session user", async () => {
    const res = await POST(jsonRequest("POST", '{"destinationId":"members"}'));
    expect(res.status).toBe(200);
    expect(toggleNavigationFavoriteMock).toHaveBeenCalledWith(
      "hq-user-1",
      "members",
    );
  });
});
