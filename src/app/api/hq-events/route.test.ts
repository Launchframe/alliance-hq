import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { GET, POST } from "./route";

const requireApiSession = vi.fn();
const requireSessionPermission = vi.fn();
const writeOfficerActionAudit = vi.fn();

vi.mock("drizzle-orm", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(actual.eq) };
});

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => requireApiSession(...args),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: (...args: unknown[]) =>
    requireSessionPermission(...args),
}));

vi.mock("@/lib/bff/officer-action-audit.server", () => ({
  writeOfficerActionAudit: (...args: unknown[]) =>
    writeOfficerActionAudit(...args),
}));

const dbState = vi.hoisted(() => ({
  insertValues: vi.fn(),
  selectResult: { current: [] as unknown[] },
  db: {
    insert: () => ({ values: (v: unknown) => dbState.insertValues(v) }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(dbState.selectResult.current),
          limit: () => Promise.resolve(dbState.selectResult.current),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db", () => {
  const table = new Proxy(
    {},
    {
      get: (_t, prop) => String(prop),
    },
  );
  const schema = new Proxy(
    {},
    {
      get: () => table,
    },
  );
  return {
    getDb: () => dbState.db,
    schema,
  };
});

const SESSION = {
  id: "sess-1",
  hqUserId: "user-1",
  allianceId: "ashed-external-1",
  currentAllianceId: "hq-ally-1",
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/hq-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/hq-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(SESSION);
    requireSessionPermission.mockResolvedValue(null);
    dbState.selectResult.current = [];
  });

  it("passes through an auth denial without touching the DB", async () => {
    requireApiSession.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(new Request("http://localhost/api/hq-events"));
    expect(res.status).toBe(401);
    expect(requireSessionPermission).not.toHaveBeenCalled();
    expect(writeOfficerActionAudit).not.toHaveBeenCalled();
  });

  it("forwards events:read denial without querying", async () => {
    requireSessionPermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await GET(new Request("http://localhost/api/hq-events"));
    expect(res.status).toBe(403);
    expect(writeOfficerActionAudit).not.toHaveBeenCalled();
  });

  it("queries with the HQ alliance id for a native session", async () => {
    requireApiSession.mockResolvedValue({
      ...SESSION,
      allianceId: null,
      currentAllianceId: "hq-native-1",
    });
    const res = await GET(
      new Request("http://localhost/api/hq-events?scoreTarget=frontline-breakthrough"),
    );
    expect(res.status).toBe(200);
    const eqCalls = (eq as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls.some(([, value]) => value === "hq-native-1")).toBe(true);
    expect(eqCalls.some(([, value]) => value === "frontline-breakthrough")).toBe(true);
  });

  it("queries with the HQ id, not the Ashed alliance id, for an Ashed session", async () => {
    const res = await GET(new Request("http://localhost/api/hq-events"));
    expect(res.status).toBe(200);
    const eqCalls = (eq as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls.some(([, value]) => value === "hq-ally-1")).toBe(true);
    expect(eqCalls.some(([, value]) => value === "ashed-external-1")).toBe(false);
  });
});

describe("POST /api/hq-events", () => {
  const validBody = {
    scoreTarget: "frontline-breakthrough",
    name: "Frontline Sep 27",
    startDate: "2026-08-31",
    endDate: "2026-08-31",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(SESSION);
    requireSessionPermission.mockResolvedValue(null);
    dbState.selectResult.current = [{ id: "ev-new" }];
  });

  it("forwards hq:events:write denial with no insert or audit", async () => {
    requireSessionPermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(403);
    expect(dbState.insertValues).not.toHaveBeenCalled();
    expect(writeOfficerActionAudit).not.toHaveBeenCalled();
  });

  it("inserts under the HQ id and audits actor, resource and permission for a native session", async () => {
    requireApiSession.mockResolvedValue({
      ...SESSION,
      allianceId: null,
      currentAllianceId: "hq-native-1",
    });
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const inserted = dbState.insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted.allianceId).toBe("hq-native-1");
    expect(inserted.scoreTarget).toBe("frontline-breakthrough");
    const eventId = inserted.id;
    expect(writeOfficerActionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        allianceId: "hq-native-1",
        hqUserId: "user-1",
        action: "hq_events.created",
        severity: "routine",
        permission: "hq:events:write",
        resourceType: "hq_event",
        resourceId: eventId,
        metadata: { scoreTarget: "frontline-breakthrough" },
      }),
    );
  });

  it("inserts under the HQ id, not the Ashed alliance id, for an Ashed session", async () => {
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const inserted = dbState.insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted.allianceId).toBe("hq-ally-1");
    expect(writeOfficerActionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "hq-ally-1", resourceType: "hq_event" }),
    );
  });

  it("rejects a missing scoreTarget or name without insert or audit", async () => {
    const res = await POST(postRequest({ scoreTarget: "frontline-breakthrough" }));
    expect(res.status).toBe(400);
    expect(dbState.insertValues).not.toHaveBeenCalled();
    expect(writeOfficerActionAudit).not.toHaveBeenCalled();
  });
});
