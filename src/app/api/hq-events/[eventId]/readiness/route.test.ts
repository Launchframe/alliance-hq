import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { POST as readinessPOST } from "./route";
import { POST as importPOST } from "../import/route";

const requireApiSession = vi.fn();
const requireSessionPermission = vi.fn();
const confirmEventReadiness = vi.fn();
const importAshedEventEvidence = vi.fn();
const linkAshedEvent = vi.fn();
const loadAshedConnection = vi.fn();
const getAshedAllianceId = vi.fn();

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
    confirmEventReadiness: (...args: unknown[]) =>
      confirmEventReadiness(...args),
  };
});
vi.mock("@/lib/hq-events/ashed-import.server", () => {
  class AshedImportError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    AshedImportError,
    importAshedEventEvidence: (...args: unknown[]) =>
      importAshedEventEvidence(...args),
    linkAshedEvent: (...args: unknown[]) => linkAshedEvent(...args),
  };
});
vi.mock("@/lib/ashed/load-ashed-connection.server", () => ({
  loadAshedConnectionForAllianceCapability: (...args: unknown[]) =>
    loadAshedConnection(...args),
}));
vi.mock("@/lib/alliance/ashed-write-guard", () => ({
  getAshedAllianceIdIfLinked: (...args: unknown[]) => getAshedAllianceId(...args),
}));

const session = { id: "sess-1", hqUserId: "hq-1" };
const params = Promise.resolve({ eventId: "ev-1" });

function post(url: string, body: unknown): Request {
  return new Request(url, {
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

describe("event readiness/import route auth boundaries", () => {
  it("anonymous session is rejected on readiness", async () => {
    requireApiSession.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    );
    const res = await readinessPOST(
      post("http://x/api/hq-events/ev-1/readiness", {
        boardId: "b1",
        action: "mark",
        expectedEvidenceVersion: 1,
      }),
      { params },
    );
    expect(res.status).toBe(401);
    expect(confirmEventReadiness).not.toHaveBeenCalled();
  });

  it("missing trains:write is rejected before touching the service", async () => {
    requireSessionPermission.mockResolvedValueOnce(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
    );
    const res = await readinessPOST(
      post("http://x/api/hq-events/ev-1/readiness", {
        boardId: "b1",
        action: "mark",
        expectedEvidenceVersion: 1,
      }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(confirmEventReadiness).not.toHaveBeenCalled();
  });

  it("anonymous session is rejected on import", async () => {
    requireApiSession.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    );
    const res = await importPOST(
      post("http://x/api/hq-events/ev-1/import", {
        action: "import",
        remoteEventId: "r1",
        requestId: "q1",
        submitEntity: "SeasonalEventScore",
      }),
      { params },
    );
    expect(res.status).toBe(401);
  });

  it("import without scores:write is rejected", async () => {
    requireSessionPermission.mockResolvedValueOnce(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
    );
    const res = await importPOST(
      post("http://x/api/hq-events/ev-1/import", {
        action: "import",
        remoteEventId: "r1",
        requestId: "q1",
        submitEntity: "SeasonalEventScore",
      }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(importAshedEventEvidence).not.toHaveBeenCalled();
  });

  it("link action requires hq:events:write and no Ashed connection", async () => {
    linkAshedEvent.mockResolvedValue({ linked: true, alreadyLinked: false });
    const res = await importPOST(
      post("http://x/api/hq-events/ev-1/import", {
        action: "link",
        remoteEventId: "r1",
      }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(loadAshedConnection).not.toHaveBeenCalled();
    expect(linkAshedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "alliance-1" }),
      { eventId: "ev-1", remoteEventId: "r1" },
    );
  });
});
