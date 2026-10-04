import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { GET, POST } from "./route";

const requireApiSession = vi.fn();
const requireSessionPermission = vi.fn();
const loadEventEvidence = vi.fn();
const commitReviewedEventEvidence = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => requireApiSession(...args),
}));
vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: (...args: unknown[]) =>
    requireSessionPermission(...args),
}));
vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: () => "alliance-1",
}));
vi.mock("@/lib/hq-events/evidence-repository.server", () => {
  class EventEvidenceError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    EventEvidenceError,
    loadEventEvidence: (...args: unknown[]) => loadEventEvidence(...args),
    commitReviewedEventEvidence: (...args: unknown[]) =>
      commitReviewedEventEvidence(...args),
  };
});

const session = { id: "sess-1", hqUserId: "hq-1" };
const params = Promise.resolve({ eventId: "ev-1" });

function post(body: unknown): Request {
  return new Request("https://hq.test/api/hq-events/ev-1/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiSession.mockResolvedValue(session);
  requireSessionPermission.mockResolvedValue(null);
});

describe("event evidence route auth boundaries", () => {
  it("anonymous session is rejected on GET", async () => {
    requireApiSession.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await GET(
      new Request("https://hq.test/api/hq-events/ev-1/evidence"),
      { params },
    );
    expect(res.status).toBe(401);
    expect(loadEventEvidence).not.toHaveBeenCalled();
  });

  it("anonymous session is rejected on POST", async () => {
    requireApiSession.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await POST(post({ requestId: "r1", boards: [] }), { params });
    expect(res.status).toBe(401);
    expect(commitReviewedEventEvidence).not.toHaveBeenCalled();
  });

  it("GET without events:read is denied", async () => {
    requireSessionPermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await GET(
      new Request("https://hq.test/api/hq-events/ev-1/evidence"),
      { params },
    );
    expect(res.status).toBe(403);
  });

  it("POST without scores:write is denied", async () => {
    requireSessionPermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await POST(
      post({ requestId: "r1", boards: [{ boardId: "b1" }] }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(commitReviewedEventEvidence).not.toHaveBeenCalled();
  });
});
