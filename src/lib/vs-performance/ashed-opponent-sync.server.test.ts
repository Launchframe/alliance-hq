import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  FakeCredentialShareError: class extends Error {
    constructor(message = "denied") {
      super(message);
      this.name = "CredentialShareError";
    }
  },
  resolveAshedConnectionForAlliance: vi.fn(),
  requireActiveShareCapability: vi.fn(),
  resolveVsAshedConnection: vi.fn(),
  decryptSecret: vi.fn((value: string) => value),
  tableRows: new Map<unknown, unknown[]>(),
  fetchCalls: [] as Array<{ url: string; method: string }>,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    schema: actual.schema,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => mocks.tableRows.get(table) ?? [],
          }),
        }),
      }),
    }),
  };
});

vi.mock("@/lib/ashed/credential-share.server", () => ({
  CredentialShareError: mocks.FakeCredentialShareError,
  resolveAshedConnectionForAlliance: mocks.resolveAshedConnectionForAlliance,
  requireActiveShareCapability: mocks.requireActiveShareCapability,
}));

vi.mock("@/lib/vs-scores/ashed-transport.server", () => ({
  resolveVsAshedConnection: mocks.resolveVsAshedConnection,
  VsSyncError: class VsSyncError extends Error {
    code: string;
    status?: number;
    constructor(code: string, status?: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock("@/lib/crypto/encrypt", () => ({
  decryptSecret: mocks.decryptSecret,
}));

import { schema } from "@/lib/db";
import {
  fetchAshedOpponentMeta,
  resolveVsOpponentSyncContext,
  resolveVsScoreReadContext,
  vsAshedSyncEligibility,
} from "./ashed-opponent-sync.server";
import { appApiUrl } from "@/lib/base44/fetch";

const actor = { sessionId: "s1", hqUserId: "u1", allianceId: "a1" };
const connection = { token: "tok", appId: "app", originUrl: "o" };

function setLink(link: { ashedAllianceId: string } | null) {
  mocks.tableRows.set(
    schema.alliances,
    link
      ? [{ ashedAllianceId: link.ashedAllianceId, operatingMode: "ashed" }]
      : [{ ashedAllianceId: null, operatingMode: "native" }],
  );
}

function setCredential(row: Record<string, unknown> | null) {
  mocks.tableRows.set(
    schema.allianceAshedCredentials,
    row ? [row] : [],
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function metaRow(partial: Record<string, unknown> = {}) {
  return {
    id: "meta-1",
    alliance_id: "ashed-a",
    competition_date: "2026-09-28",
    opponent_server: 1236,
    opponent_tag: "FOE",
    opponent_name: "Opponent",
    opponent_daily_scores: [1, 2, 3, 4, 5, 6, 0],
    outcome: "loss",
    updated_date: "2026-09-28T06:33:16.296Z",
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tableRows.clear();
  mocks.fetchCalls.length = 0;
  setLink({ ashedAllianceId: "ashed-a" });
  setCredential(null);
  mocks.resolveAshedConnectionForAlliance.mockResolvedValue(null);
  mocks.resolveVsAshedConnection.mockResolvedValue(null);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    mocks.fetchCalls.push({ url, method: init?.method ?? "GET" });
    return jsonResponse(404, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveVsScoreReadContext", () => {
  it("returns null for a native alliance", async () => {
    setLink(null);
    await expect(resolveVsScoreReadContext(actor)).resolves.toBeNull();
  });

  it("propagates delegated-share denial without installed fallback", async () => {
    mocks.resolveAshedConnectionForAlliance.mockResolvedValue({
      isDelegated: true,
      connection,
    });
    mocks.requireActiveShareCapability.mockRejectedValue(
      new mocks.FakeCredentialShareError(),
    );
    setCredential({
      encryptedToken: "installed",
      appId: "app",
      originUrl: "o",
      tokenExpiresAt: null,
    });
    await expect(resolveVsScoreReadContext(actor)).rejects.toMatchObject({
      code: "credentials_required",
    });
  });

  it("returns the session connection when it is not delegated", async () => {
    mocks.resolveAshedConnectionForAlliance.mockResolvedValue({
      isDelegated: false,
      connection,
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      mocks.fetchCalls.push({ url, method: init?.method ?? "GET" });
      const target = typeof url === "string" ? url : String(url);
      if (target.includes("/entities/User/me")) {
        return jsonResponse(200, {
          id: "ashed-user-1",
          email: "officer@example.com",
        });
      }
      if (target.includes("/entities/Alliance/")) {
        return jsonResponse(200, {
          id: "ashed-a",
          tag: "VA",
          owner_email: "officer@example.com",
          collaborators: [],
        });
      }
      return jsonResponse(404, {});
    });
    await expect(resolveVsScoreReadContext(actor)).resolves.toMatchObject({
      ashedAllianceId: "ashed-a",
      connection,
    });
  });

  it("rejects an expired installed credential and accepts a live one", async () => {
    setCredential({
      encryptedToken: "expired-tok",
      appId: "app",
      originUrl: "o",
      tokenExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(resolveVsScoreReadContext(actor)).resolves.toBeNull();
    mocks.resolveVsAshedConnection.mockResolvedValue({
      connection: { token: "live-tok", appId: "app", originUrl: "o" },
      allianceId: "ashed-a",
    });
    const context = await resolveVsScoreReadContext(actor);
    expect(context?.connection.token).toBe("live-tok");
  });
});

describe("resolveVsOpponentSyncContext", () => {
  it("does not fall back to installed credentials after delegated denial", async () => {
    mocks.resolveAshedConnectionForAlliance.mockResolvedValue({
      isDelegated: true,
      connection,
    });
    mocks.requireActiveShareCapability.mockRejectedValue(
      new mocks.FakeCredentialShareError(),
    );
    await expect(resolveVsOpponentSyncContext(actor)).rejects.toMatchObject({
      code: "credentials_required",
    });
    expect(mocks.resolveVsAshedConnection).not.toHaveBeenCalled();
  });

  it("verifies remote access and rejects 401", async () => {
    mocks.resolveAshedConnectionForAlliance.mockResolvedValue({
      isDelegated: false,
      connection,
    });
    vi.stubGlobal("fetch", async () => jsonResponse(401, {}));
    await expect(resolveVsOpponentSyncContext(actor)).rejects.toMatchObject({
      code: "credentials_required",
    });
  });

  it("rejects a foreign alliance record during access verification", async () => {
    mocks.resolveAshedConnectionForAlliance.mockResolvedValue({
      isDelegated: false,
      connection,
    });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/entities/User/me"))
        return jsonResponse(200, { email: "officer@x.test", id: "u-ashed" });
      return jsonResponse(200, {
        id: "another-alliance",
        tag: "FOE",
        collaborators: ["officer@x.test"],
      });
    });
    await expect(resolveVsOpponentSyncContext(actor)).rejects.toMatchObject({
      code: "credentials_required",
    });
  });

  it("resolves when the remote user has alliance access", async () => {
    mocks.resolveAshedConnectionForAlliance.mockResolvedValue({
      isDelegated: false,
      connection,
    });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/entities/User/me"))
        return jsonResponse(200, { email: "officer@x.test", id: "u-ashed" });
      return jsonResponse(200, {
        id: "ashed-a",
        tag: "FOE",
        collaborators: ["officer@x.test"],
      });
    });
    const context = await resolveVsOpponentSyncContext(actor);
    expect(context?.allianceId).toBe("ashed-a");
    expect(context?.connection).toEqual(connection);
  });
});

describe("fetchAshedOpponentMeta", () => {
  const context = { connection, allianceId: "ashed-a" };

  it("paginates and returns validated rows", async () => {
    const pages: unknown[][] = [
      Array.from({ length: 200 }, (_, index) =>
        metaRow({ id: `r${index}` }),
      ),
      [metaRow({ id: "r200" })],
    ];
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return jsonResponse(200, pages.shift() ?? []);
    });
    const rows = await fetchAshedOpponentMeta(context);
    expect(rows).toHaveLength(201);
    expect(calls).toBe(2);
  });

  it("skips sample rows and rejects duplicate ids", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse(200, [
        metaRow({ id: "x", is_sample: true }),
        metaRow({ id: "y" }),
      ]),
    );
    await expect(fetchAshedOpponentMeta(context)).resolves.toHaveLength(1);
    vi.stubGlobal("fetch", async () =>
      jsonResponse(200, [metaRow({ id: "y" }), metaRow({ id: "y" })]),
    );
    await expect(fetchAshedOpponentMeta(context)).rejects.toMatchObject({
      code: "invalid_snapshot",
    });
  });

  it("rejects rows for another alliance", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse(200, [metaRow({ alliance_id: "other" })]),
    );
    await expect(fetchAshedOpponentMeta(context)).rejects.toMatchObject({
      code: "invalid_snapshot",
    });
  });

  it("rejects oversized bodies and expired deadlines before fetch", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("x".repeat(4_000_001), { status: 200 }),
    );
    await expect(fetchAshedOpponentMeta(context)).rejects.toMatchObject({
      code: "invalid_snapshot",
    });
    await expect(
      fetchAshedOpponentMeta({ ...context, deadline: Date.now() - 1 }),
    ).rejects.toMatchObject({ code: "failed" });
  });
});

describe("vsAshedSyncEligibility", () => {
  it("contains credential resolution failures", async () => {
    mocks.resolveAshedConnectionForAlliance.mockRejectedValue(
      new Error("db down"),
    );
    setCredential({
      tokenExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(vsAshedSyncEligibility(actor)).resolves.toBe(false);
  });

  it("reports a live installed credential as eligible", async () => {
    setCredential({
      tokenExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(vsAshedSyncEligibility(actor)).resolves.toBe(true);
  });
});

describe("ASHED_API_BASE_ORIGIN test seam", () => {
  const ORIGIN = process.env.ASHED_API_BASE_ORIGIN;
  const E2E = process.env.E2E_TEST;
  afterEach(() => {
    process.env.ASHED_API_BASE_ORIGIN = ORIGIN;
    process.env.E2E_TEST = E2E;
  });

  it("ignores the override outside E2E", () => {
    delete process.env.E2E_TEST;
    process.env.ASHED_API_BASE_ORIGIN = "https://evil.example";
    expect(appApiUrl(connection, "/entities/User/me")).toBe(
      "https://base44.app/api/apps/app/entities/User/me",
    );
  });

  it("rejects non-loopback overrides in E2E", () => {
    process.env.E2E_TEST = "true";
    process.env.ASHED_API_BASE_ORIGIN = "https://evil.example";
    expect(() => appApiUrl(connection, "/x")).toThrow(
      "HTTP loopback URL",
    );
    process.env.ASHED_API_BASE_ORIGIN = "http://127.0.0.1:8080/path?q=1";
    expect(() => appApiUrl(connection, "/x")).toThrow(
      "HTTP loopback URL",
    );
    process.env.ASHED_API_BASE_ORIGIN = "http://user@127.0.0.1:8080";
    expect(() => appApiUrl(connection, "/x")).toThrow(
      "HTTP loopback URL",
    );
  });

  it("accepts a loopback override in E2E", () => {
    process.env.E2E_TEST = "true";
    process.env.ASHED_API_BASE_ORIGIN = "http://127.0.0.1:14789";
    expect(appApiUrl(connection, "/entities/User/me")).toBe(
      "http://127.0.0.1:14789/api/apps/app/entities/User/me",
    );
  });
});
