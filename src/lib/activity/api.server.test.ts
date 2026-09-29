import { beforeEach, describe, expect, it, vi } from "vitest";

import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";

const mocks = vi.hoisted(() => ({
  requireActivityPrincipal: vi.fn(),
  queryActivityPage: vi.fn(),
  queryActivityHead: vi.fn(),
  queryActivityFilterOptions: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/rbac/context", () => ({ getRbacContext: vi.fn() }));
vi.mock("@/lib/rbac/require-permission", () => ({
  requirePlatformMaintainer: vi.fn(),
  requireSessionPermission: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
  cookies: mocks.cookies,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async ({ locale }: { locale: string }) =>
      (key: string) =>
        (
          (locale === "pt-BR" ? ptBR : enUS).activity as unknown as Record<
            string,
            string
          >
        )[key],
  ),
}));

vi.mock("./access.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access.server")>();
  return { ...actual, requireActivityPrincipal: mocks.requireActivityPrincipal };
});
vi.mock("./query.server", () => ({
  queryActivityPage: mocks.queryActivityPage,
  queryActivityHead: mocks.queryActivityHead,
  queryActivityFilterOptions: mocks.queryActivityFilterOptions,
}));

import { ActivityReadError, type ActivityPrincipal } from "./access.server";
import {
  handleActivityRead,
  parseActivityFeedQuery,
} from "./api.server";
import type { ActivityFeedScope } from "./feed.shared";

const PRINCIPAL: ActivityPrincipal = {
  hqUserId: "user-1",
  sessionId: "session-1",
  currentAllianceId: "alliance-1",
  permissions: new Set(["hq:audit:read"]),
  isPlatformMaintainer: false,
  scopeFence: JSON.stringify(["user-1", "alliance-1"]),
};

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

function invalidParse(scope: ActivityFeedScope, query: string) {
  try {
    parseActivityFeedQuery(params(query), scope);
  } catch (error) {
    expect(error).toBeInstanceOf(ActivityReadError);
    expect((error as ActivityReadError).code).toBe("invalid");
    expect((error as ActivityReadError).status).toBe(400);
    return;
  }
  throw new Error(`expected invalid for ${scope}?${query}`);
}

describe("parseActivityFeedQuery", () => {
  it("applies defaults on an empty query", () => {
    expect(parseActivityFeedQuery(params(""), "personal")).toEqual({
      view: "page",
      limit: 50,
      cursor: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
      channel: undefined,
      category: undefined,
      kind: undefined,
      actor: undefined,
      allianceId: undefined,
      server: undefined,
    });
  });

  it("accepts the full closed key set per scope", () => {
    const parsed = parseActivityFeedQuery(
      params(
        "view=page&limit=7&channel=web&category=thp&kind=change" +
          "&actor=hq%3Auser-9&from=2026-09-29T00%3A00%3A00.123456Z" +
          "&to=2026-09-30T00%3A00%3A00Z&cursor=abc",
      ),
      "alliance",
    );
    expect(parsed).toMatchObject({
      view: "page",
      limit: 7,
      channel: "web",
      category: "thp",
      kind: "change",
      actor: "hq:user-9",
      from: "2026-09-29T00:00:00.123456Z",
      to: "2026-09-30T00:00:00Z",
      cursor: "abc",
    });

    const global = parseActivityFeedQuery(
      params("view=filters&server=1203&allianceId=abc-123&q=TST"),
      "global",
    );
    expect(global.server).toBe("1203");
    expect(global.allianceId).toBe("abc-123");
    expect(global.q).toBe("TST");
  });

  it("rejects unknown and duplicate keys", () => {
    invalidParse("personal", "bogus=1");
    invalidParse("personal", "limit=1&limit=2");
    invalidParse("personal", "from=2026-01-01T00%3A00%3A00Z&from=2026-01-02T00%3A00%3A00Z");
  });

  it("rejects malformed limits, views, and cursors", () => {
    invalidParse("personal", "limit=0");
    invalidParse("personal", "limit=101");
    invalidParse("personal", "limit=1.5");
    invalidParse("personal", "limit=-3");
    invalidParse("personal", "limit=abc");
    invalidParse("personal", "view=bogus");
    invalidParse("personal", `cursor=${"x".repeat(1601)}`);
    invalidParse("personal", "view=head&cursor=abc");
    invalidParse("personal", "view=filters&cursor=abc");
  });

  it("rejects q outside the filters view and overlong q", () => {
    invalidParse("personal", "q=test");
    invalidParse("personal", "view=head&q=test");
    invalidParse("personal", `view=filters&q=${"x".repeat(81)}`);
    invalidParse("personal", "view=filters&q=%20%20");
  });

  it("rejects malformed or inverted from/to ranges", () => {
    invalidParse("personal", "from=not-a-date");
    invalidParse("personal", `from=${"x".repeat(41)}`);
    invalidParse(
      "personal",
      "from=2026-10-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z",
    );
    invalidParse(
      "personal",
      "from=2026-09-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z",
    );
  });

  it("honors microsecond-wide ranges but rejects degenerate ones", () => {
    const ok = parseActivityFeedQuery(
      params(
        "from=2026-09-01T00%3A00%3A00.123455Z&to=2026-09-01T00%3A00%3A00.123456Z",
      ),
      "personal",
    );
    expect(ok.from).toBe("2026-09-01T00:00:00.123455Z");
    expect(ok.to).toBe("2026-09-01T00:00:00.123456Z");

    invalidParse(
      "personal",
      "from=2026-09-01T00%3A00%3A00.123456Z&to=2026-09-01T00%3A00%3A00.123455Z",
    );
    invalidParse(
      "personal",
      "from=2026-09-01T00%3A00%3A00.123456Z&to=2026-09-01T00%3A00%3A00.123456Z",
    );
    invalidParse(
      "personal",
      "from=2026-01-01T12%3A00%3A00%2B02%3A00&to=2026-01-01T10%3A00%3A00Z",
    );
    invalidParse("personal", "from=0000-01-01T00%3A00%3A00Z");
    invalidParse("personal", "from=2026-09-01T00%3A00%3A00.1234567Z");
  });

  it("rejects empty and oversized cursors", () => {
    invalidParse("personal", "cursor=");
    invalidParse("personal", `cursor=${"x".repeat(1601)}`);
  });

  it("rejects out-of-registry channel, kind, and category values", () => {
    invalidParse("personal", "channel=pigeon");
    invalidParse("personal", "kind=bogus");
    invalidParse("personal", "category=bogus");
    parseActivityFeedQuery(params("category=thp"), "personal");
  });

  it("enforces per-scope control restrictions", () => {
    invalidParse("personal", "actor=hq%3Auser-9");
    invalidParse("alliance", "allianceId=alliance-1");
    invalidParse("alliance", "server=1203");
    invalidParse("personal", "server=1203");
    invalidParse("personal", "allianceId=bad%20id%21");
    invalidParse("alliance", "actor=weird%3Auser-9");
    invalidParse("alliance", "actor=hq%3Abad%40actor");
    parseActivityFeedQuery(params("actor=discord%3Aabc_123"), "alliance");
    parseActivityFeedQuery(params("server=12345678"), "global");
  });
});

describe("handleActivityRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActivityPrincipal.mockResolvedValue(PRINCIPAL);
    mocks.queryActivityPage.mockResolvedValue({ items: [], scope: "personal" });
    mocks.queryActivityHead.mockResolvedValue({ head: null });
    mocks.queryActivityFilterOptions.mockResolvedValue({ options: {} });
    mocks.cookies.mockResolvedValue({ get: () => undefined });
  });

  function request(query = "", headers: Record<string, string> = {}): Request {
    return new Request(`https://hq.test/api/activity/personal${query}`, {
      headers,
    });
  }

  it("returns 200 with no-store on success", async () => {
    const res = await handleActivityRead(request("?view=page"), "personal");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ items: [], scope: "personal" });
  });

  it("dispatches head and filters views", async () => {
    await handleActivityRead(request("?view=head"), "personal");
    expect(mocks.queryActivityHead).toHaveBeenCalled();
    await handleActivityRead(request("?view=filters"), "personal");
    expect(mocks.queryActivityFilterOptions).toHaveBeenCalled();
  });

  it("maps unauthorized and forbidden to accessChanged", async () => {
    mocks.requireActivityPrincipal.mockRejectedValue(
      new ActivityReadError("unauthorized", 401),
    );
    let res = await handleActivityRead(request(), "personal");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: enUS.activity.accessChanged,
      errorKey: "activity.accessChanged",
      code: "unauthorized",
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    mocks.requireActivityPrincipal.mockRejectedValue(
      new ActivityReadError("forbidden", 403),
    );
    res = await handleActivityRead(request(), "alliance");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: enUS.activity.accessChanged,
      errorKey: "activity.accessChanged",
      code: "forbidden",
    });
  });

  it("localizes errors from the activity locale header or cookie", async () => {
    mocks.requireActivityPrincipal.mockRejectedValue(
      new ActivityReadError("forbidden", 403),
    );

    const byHeader = await handleActivityRead(
      request("", { "x-activity-locale": "pt-BR" }),
      "alliance",
    );
    expect(await byHeader.json()).toEqual({
      error: ptBR.activity.accessChanged,
      errorKey: "activity.accessChanged",
      code: "forbidden",
    });

    mocks.cookies.mockResolvedValue({
      get: (name: string) =>
        name === "NEXT_LOCALE" ? { value: "pt-BR" } : undefined,
    });
    const byCookie = await handleActivityRead(request(), "alliance");
    expect((await byCookie.json()).error).toBe(ptBR.activity.accessChanged);

    const invalid = await handleActivityRead(
      request("", { "x-activity-locale": "fr-FR" }),
      "alliance",
    );
    expect((await invalid.json()).error).toBe(enUS.activity.accessChanged);
  });

  it("maps invalid input and record failures to loadFailed", async () => {
    let res = await handleActivityRead(request("?limit=0"), "personal");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: enUS.activity.loadFailed,
      errorKey: "activity.loadFailed",
      code: "invalid",
    });

    mocks.queryActivityPage.mockRejectedValue(
      new ActivityReadError("invalid_record", 500),
    );
    res = await handleActivityRead(request(), "personal");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: enUS.activity.loadFailed,
      errorKey: "activity.loadFailed",
      code: "invalid_record",
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("maps unexpected errors to a generic 500", async () => {
    mocks.queryActivityPage.mockRejectedValue(new Error("db down"));
    const res = await handleActivityRead(request(), "personal");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: enUS.activity.loadFailed,
      errorKey: "activity.loadFailed",
      code: "internal",
    });
  });
});
