import { createServer, type Server } from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  addCalendarDays,
  getWeekStartMonday,
} from "../src/lib/trains/game-time";
import { encryptSecret } from "../src/lib/crypto/encrypt";
import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
} from "../src/lib/connectionString";
import {
  attachAshedConnectionToSession,
  createAllianceMembership,
  createAllianceRosterMember,
  createAshedAlliance,
  createAuthenticatedHqSession,
  createNativeAlliance,
  createHqMemberLink,
  getE2eSql,
  playwrightAuthCookies,
  type Sql,
} from "./fixtures/db";

const MOCK_PORT = 14789;
const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;
const OWNER_EMAIL = "vs-officer@e2e.test";

type MockState = {
  userEmail: string;
  records: Record<string, unknown>[];
  scoreRows: Record<string, unknown>[];
  posts: Record<string, unknown>[];
  puts: Array<{ id: string; body: Record<string, unknown> }>;
  holdMetaGets: number;
  pendingMetaGets: Array<() => void>;
  gateMetaPut: boolean;
  pendingMetaPuts: Array<() => void>;
  postBehavior:
    | "ok"
    | "apply-then-500"
    | "apply-then-timeout"
    | "apply-then-malformed";
  metaGetErrorStatus: number | null;
  scoreGetErrorStatus: number | null;
  metaGetCount: number;
  scoreGetCount: number;
};

const mockState: MockState = {
  userEmail: OWNER_EMAIL,
  records: [],
  scoreRows: [],
  posts: [],
  puts: [],
  holdMetaGets: 0,
  pendingMetaGets: [],
  gateMetaPut: false,
  pendingMetaPuts: [],
  postBehavior: "ok",
  metaGetErrorStatus: null,
  scoreGetErrorStatus: null,
  metaGetCount: 0,
  scoreGetCount: 0,
};

function resetMock() {
  mockState.records = [];
  mockState.scoreRows = [];
  mockState.posts = [];
  mockState.puts = [];
  mockState.holdMetaGets = 0;
  mockState.pendingMetaGets = [];
  mockState.gateMetaPut = false;
  mockState.pendingMetaPuts = [];
  mockState.postBehavior = "ok";
  mockState.metaGetErrorStatus = null;
  mockState.scoreGetErrorStatus = null;
  mockState.metaGetCount = 0;
  mockState.scoreGetCount = 0;
}

function releaseHeldRequests(queue: Array<() => void>) {
  const held = queue.splice(0, queue.length);
  for (const release of held) release();
}

function holdRequest(
  gated: boolean,
  queue: Array<() => void>,
): Promise<void> | null {
  if (!gated) return null;
  return new Promise<void>((resolve) => queue.push(resolve));
}

function queryFilter(url: URL): Record<string, unknown> {
  const raw = url.searchParams.get("q");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function pagedRows(
  url: URL,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const filter = queryFilter(url);
  const filtered = rows.filter((row) =>
    Object.entries(filter).every(([key, value]) => row[key] === value),
  );
  filtered.sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
  const skip = Number(url.searchParams.get("skip") ?? "0") || 0;
  const limit = Number(url.searchParams.get("limit") ?? "0") || filtered.length;
  return filtered.slice(skip, skip + limit);
}

async function readBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function metaRecord(
  weekStart: string,
  allianceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `meta-${nanoid(6)}`,
    alliance_id: allianceId,
    competition_date: weekStart,
    week_type: "normal",
    opponent_server: 1236,
    opponent_tag: "FOE",
    opponent_name: "Opponent",
    opponent_daily_scores: [1, 2, 3, 4, 5, 6, 0],
    outcome: "loss",
    updated_date: `${weekStart}T06:33:16.296000`,
    notes: "preserve",
    daily_types: [
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
    ],
    ...overrides,
  };
}

function startAshedMock(): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", MOCK_ORIGIN);
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const marker = "/entities/";
      const idx = url.pathname.indexOf(marker);
      if (idx < 0) return send(404, {});
      const entity = url.pathname.slice(idx + marker.length);

      if (req.method === "GET" && entity === "User/me") {
        return send(200, { id: "e2e-ashed-user", email: mockState.userEmail });
      }
      if (req.method === "GET" && entity.startsWith("Alliance/")) {
        const id = decodeURIComponent(entity.slice("Alliance/".length));
        return send(200, {
          id,
          tag: "E2E",
          owner_email: mockState.userEmail,
          collaborators: [],
        });
      }
      if (req.method === "GET" && entity === "VSScore") {
        mockState.scoreGetCount += 1;
        if (mockState.scoreGetErrorStatus != null) {
          return send(mockState.scoreGetErrorStatus, {});
        }
        return send(200, pagedRows(url, mockState.scoreRows));
      }
      if (req.method === "GET" && entity === "VSCompetitionMeta") {
        mockState.metaGetCount += 1;
        if (mockState.metaGetErrorStatus != null) {
          return send(mockState.metaGetErrorStatus, {});
        }
        if (mockState.holdMetaGets > 0) {
          mockState.holdMetaGets -= 1;
          await new Promise<void>((resolve) =>
            mockState.pendingMetaGets.push(resolve),
          );
        }
        return send(200, pagedRows(url, mockState.records));
      }
      if (req.method === "POST" && entity === "VSCompetitionMeta") {
        const body = await readBody(req);
        mockState.posts.push(body);
        const id = `meta-created-${nanoid(6)}`;
        mockState.records.push({
          id,
          alliance_id: body.alliance_id,
          competition_date: body.competition_date,
          week_type: body.week_type,
          opponent_server: body.opponent_server ?? null,
          opponent_tag: body.opponent_tag ?? null,
          opponent_name: body.opponent_name ?? null,
          opponent_daily_scores: body.opponent_daily_scores ?? null,
          outcome: body.outcome ?? "pending",
          updated_date: new Date().toISOString(),
        });
        if (mockState.postBehavior === "apply-then-500") {
          return send(500, {});
        }
        if (mockState.postBehavior === "apply-then-malformed") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end("not-json");
        }
        if (mockState.postBehavior === "apply-then-timeout") {
          return new Promise(() => undefined);
        }
        return send(200, { id });
      }
      if (req.method === "PUT" && entity.startsWith("VSCompetitionMeta/")) {
        const id = decodeURIComponent(
          entity.slice("VSCompetitionMeta/".length),
        );
        const body = await readBody(req);
        mockState.puts.push({ id, body });
        const record = mockState.records.find((row) => row.id === id);
        if (record) {
          Object.assign(record, body, {
            updated_date: new Date().toISOString(),
          });
        }
        const gate = holdRequest(
          mockState.gateMetaPut,
          mockState.pendingMetaPuts,
        );
        if (gate) await gate;
        return send(200, {});
      }
      return send(404, {});
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server));
  });
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function setupAshedAlliance(
  request: APIRequestContext,
  roleName: "officer" | "viewer" | "member",
) {
  const sql = getE2eSql();
  const alliance = await createAshedAlliance(sql, {
    tag: `VA${nanoid(4)}`,
    name: "VS Ashed Alliance",
  });
  const externalId = `ashed-ext-${nanoid(8)}`;
  await sql`
    UPDATE alliances SET ashed_alliance_id = ${externalId}
    WHERE id = ${alliance.allianceId}
  `;
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail(`vs-ashed-${roleName}`),
  );
  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: alliance.allianceId,
    roleName,
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: auth.hqUserId,
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "VS Ashed Roster Member",
  });
  await attachAshedConnectionToSession(sql, auth.sessionId);
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;
  const cookieHeader = playwrightAuthCookies({
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
  })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  return { alliance, auth, cookieHeader, externalId };
}

type VsMatchup = {
  id: string;
  version: number;
  opponentName: string | null;
  opponentTag: string | null;
  opponentServer: number | null;
  opponentDailyScores: (string | null)[];
  weekOutcome: string;
  sync?: {
    status: string;
    errorCode: string | null;
    conflicts: Array<{ field: string }>;
    conflictToken: string | null;
  } | null;
  days: Array<{ recordedDate: string; outcome: string; version: number }>;
};

type VsWeekPayload = {
  weekStart: string;
  today: string;
  scope: string;
  contextScope: string;
  canEdit: boolean;
  canImportAshed: boolean;
  matchup: VsMatchup | null;
  memberScoreChecks?: Record<
    string,
    { status: string; uploaded?: string; confirmed?: string; difference?: string }
  >;
  days: Array<{ scoreDate: string; trainDate: string }>;
};

async function fetchWeek(
  request: APIRequestContext,
  cookieHeader: string,
  weekStart?: string,
): Promise<VsWeekPayload> {
  const res = await request.get(
    `/api/vs-performance/week${weekStart ? `?weekStart=${weekStart}` : ""}`,
    { headers: { Cookie: cookieHeader } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as VsWeekPayload;
}

test.describe.configure({ mode: "serial" });

let mockServer: Server;

test.beforeAll(async () => {
  mockServer = await startAshedMock();
});

test.afterAll(async () => {
  await new Promise((resolve) => mockServer.close(resolve));
});

test.beforeEach(() => {
  resetMock();
});

test.describe("VS Ashed opponent sync API", () => {
  test("native alliance without an Ashed link cannot pull", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `VN${nanoid(4)}`,
      name: "VS Native",
    });
    const auth = await createAuthenticatedHqSession(sql, uniqueEmail("vs-n"));
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${auth.sessionId}
    `;
    const cookieHeader = playwrightAuthCookies({
      sessionId: auth.sessionId,
      nextAuthToken: auth.nextAuthToken,
    })
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const week = await fetchWeek(request, cookieHeader);
    expect(week.canImportAshed).toBe(false);
    const res = await request.post("/api/vs-performance/matchup/import", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: week.weekStart, scope: week.scope },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("ashed_unavailable");
  });

  test("pull imports remote opponent identity, scores, and outcome with empty historical weeks", async ({
    request,
  }) => {
    const { cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));
    mockState.records = [
      metaRecord(pastWeek, externalId),
      metaRecord(addCalendarDays(pastWeek, -7), externalId, {
        opponent_server: null, opponent_tag: null, opponent_name: null,
        opponent_daily_scores: [], outcome: 'pending',
      }),
    ];

    const week = await fetchWeek(request, cookieHeader, pastWeek);
    expect(week.canImportAshed).toBe(true);

    const res = await request.post("/api/vs-performance/matchup/import", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: week.scope },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const payload = (await res.json()) as VsWeekPayload;
    const matchup = payload.matchup!;
    expect(matchup.opponentName).toBe("Opponent");
    expect(matchup.opponentTag).toBe("FOE");
    expect(matchup.opponentServer).toBe(1236);
    expect(matchup.weekOutcome).toBe("loss");
    expect(matchup.opponentDailyScores).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(matchup.sync?.status).toBe("synced");
    const sql = getE2eSql();
    const [row] = await sql<
      { external_competition_id: string | null; identity_source: string }[]
    >`
      SELECT external_competition_id, identity_source
      FROM vs_matchups WHERE id = ${matchup.id}
    `;
    expect(row?.external_competition_id).toBe(mockState.records[0]!.id);
    expect(row?.identity_source).toBe("ashed_import");
    expect(matchup.days).toHaveLength(0);
    const syncRes = await request.post('/api/vs-performance/matchup/sync', {
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      data: { weekStart: pastWeek, scope: payload.scope },
    });
    expect(syncRes.ok(), await syncRes.text()).toBeTruthy();
    const synced = (await syncRes.json()) as VsWeekPayload;
    expect(synced.matchup?.sync?.status).toBe('synced');
    expect(synced.matchup?.opponentDailyScores).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(synced.matchup?.days).toHaveLength(0);
    const historyRes = await request.get('/api/vs-performance/matchup/opponents', { headers: { Cookie: cookieHeader } });
    expect(historyRes.ok(), await historyRes.text()).toBeTruthy();
    const history = await historyRes.json();
    expect(history.ashedUnavailable).toBe(false);
    expect(history.opponents).toContainEqual({ server: 1236, tag: 'FOE', name: 'Opponent' });
    expect(mockState.posts).toHaveLength(0);
    expect(mockState.puts).toHaveLength(0);
    expect(mockState.records[1].opponent_daily_scores).toEqual([]);
  });

  test("member is denied import, sync, and capture parse", async ({
    request,
  }) => {
    const { cookieHeader } = await setupAshedAlliance(request, "member");
    const week = await fetchWeek(request, cookieHeader);
    const importRes = await request.post(
      "/api/vs-performance/matchup/import",
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { weekStart: week.weekStart, scope: week.scope },
      },
    );
    expect(importRes.status()).toBe(403);
    const syncRes = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: week.weekStart, scope: week.scope },
    });
    expect(syncRes.status()).toBe(403);
    const parseRes = await request.post("/api/vs-performance/captures/parse", {
      headers: { Cookie: cookieHeader },
      multipart: {
        image: {
          name: "x.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from([0xff, 0xd8, 0xff]),
        },
        kind: "daily_totals",
        weekStart: week.weekStart,
        scope: week.scope,
      },
    });
    expect(parseRes.status()).toBe(403);
  });

  test("import rejects a scope from a different context", async ({
    request,
  }) => {
    const first = await setupAshedAlliance(request, "officer");
    const second = await setupAshedAlliance(request, "officer");
    const week = await fetchWeek(request, first.cookieHeader);
    const res = await request.post("/api/vs-performance/matchup/import", {
      headers: { Cookie: second.cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: week.weekStart, scope: week.scope },
    });
    expect(res.status()).toBe(409);
  });

  test("opponent score save creates the remote record once with whitelisted fields", async ({
    request,
  }) => {
    const { cookieHeader } = await setupAshedAlliance(request, "officer");
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = await fetchWeek(request, cookieHeader, pastWeek);

    const identityRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe Alliance",
        opponentTag: "FOE",
        opponentServer: 1236,
        weekOutcome: "pending",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    expect(identityRes.ok(), await identityRes.text()).toBeTruthy();

    expect(mockState.posts).toHaveLength(1);
    const create = mockState.posts[0]!;
    expect(Object.keys(create).sort()).toEqual(
      [
        "alliance_id",
        "competition_date",
        "opponent_daily_scores",
        "opponent_name",
        "opponent_server",
        "opponent_tag",
        "outcome",
        "week_type",
      ].sort(),
    );
    expect(create.week_type).toBe("normal");
    expect(create.competition_date).toBe(pastWeek);
    expect(create.opponent_daily_scores).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      0,
    ]);

    const afterCreate = await fetchWeek(request, cookieHeader, pastWeek);
    const res = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe Alliance",
        opponentTag: "FOE",
        opponentScores: [{ day: 2, score: "42" }],
        expectedVersion: afterCreate.matchup!.version,
        scope: afterCreate.scope,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    expect(mockState.posts).toHaveLength(1);
    expect(mockState.puts).toHaveLength(1);
    expect(mockState.puts[0]!.body.opponent_daily_scores).toEqual([
      null,
      42,
      null,
      null,
      null,
      null,
      0,
    ]);

    const refreshed = await fetchWeek(request, cookieHeader, pastWeek);
    expect(refreshed.matchup?.sync?.status).toBe("synced");
    const sql = getE2eSql();
    const [row] = await sql<{ external_competition_id: string | null }[]>`
      SELECT external_competition_id FROM vs_matchups
      WHERE id = ${refreshed.matchup!.id}
    `;
    expect(row?.external_competition_id).toBeTruthy();
  });

  test("remote change on a dirty day conflicts; keep HQ pushes the local value", async ({
    request,
  }) => {
    const { cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const record = metaRecord(pastWeek, externalId);
    mockState.records = [record];

    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const importRes = await request.post("/api/vs-performance/matchup/import", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: week.scope },
    });
    expect(importRes.ok()).toBeTruthy();

    record.opponent_daily_scores = [1, 77, 3, 4, 5, 6, 0];
    const moved = await fetchWeek(request, cookieHeader, pastWeek);

    const saveRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentScores: [{ day: 2, score: "99" }],
        expectedVersion: moved.matchup!.version,
        scope: moved.scope,
      },
    });
    expect(saveRes.ok(), await saveRes.text()).toBeTruthy();

    const conflicted = await fetchWeek(request, cookieHeader, pastWeek);
    const sync = conflicted.matchup!.sync!;
    expect(sync.status).toBe("conflict");
    expect(sync.conflicts.map((c) => c.field)).toContain("day:2");
    expect(mockState.puts).toHaveLength(0);

    const keepRes = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        scope: conflicted.scope,
        resolution: "keep_hq",
        conflictToken: sync.conflictToken,
      },
    });
    expect(keepRes.ok(), await keepRes.text()).toBeTruthy();
    expect(mockState.puts).toHaveLength(1);
    const put = mockState.puts[0]!;
    expect(put.id).toBe(record.id);
    expect(
      (put.body.opponent_daily_scores as number[])[1],
    ).toBe(99);
    expect(put.body.opponent_daily_scores).toEqual([1, 99, 3, 4, 5, 6, 0]);

    const resolved = await fetchWeek(request, cookieHeader, pastWeek);
    expect(resolved.matchup?.sync?.status).toBe("synced");
  });

  test("a stale conflict token is rejected with 409", async ({ request }) => {
    const { cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const record = metaRecord(pastWeek, externalId);
    mockState.records = [record];
    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const importRes = await request.post("/api/vs-performance/matchup/import", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: week.scope },
    });
    expect(importRes.ok()).toBeTruthy();
    record.opponent_daily_scores = [1, 77, 3, 4, 5, 6, 0];
    const moved = await fetchWeek(request, cookieHeader, pastWeek);
    const saveRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentScores: [{ day: 2, score: "99" }],
        expectedVersion: moved.matchup!.version,
        scope: moved.scope,
      },
    });
    expect(saveRes.ok()).toBeTruthy();
    const conflicted = await fetchWeek(request, cookieHeader, pastWeek);
    expect(conflicted.matchup?.sync?.status).toBe("conflict");
    const res = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        scope: conflicted.scope,
        resolution: "keep_hq",
        conflictToken: "bogus",
      },
    });
    expect(res.status()).toBe(409);
    expect(mockState.puts).toHaveLength(0);
  });

  test("confirmed totals reconcile against uploaded member scores", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, cookieHeader } = await setupAshedAlliance(
      request,
      "officer",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = await fetchWeek(request, cookieHeader, pastWeek);

    const memberA = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Recon A",
    });
    const memberB = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Recon B",
    });
    const scoreDate = week.days[0]!.scoreDate;
    for (const [member, score] of [
      [memberA, 60],
      [memberB, 40],
    ] as const) {
      await sql`
        INSERT INTO vs_score_heads (id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version, basis, updated_at)
        VALUES (${nanoid(16)}, ${alliance.allianceId}, ${member.ashedMemberId}, 'x', ${scoreDate}, 'daily', ${score}, 'hq', 1, ${sql.json([])}, ${new Date()})
      `;
    }

    const matchupRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    const matchup = (await matchupRes.json()) as VsMatchup;
    const dayRes = await request.patch(
      `/api/vs-performance/matchup/days/${scoreDate}`,
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          matchupId: matchup.id,
          expectedVersion: 0,
          requestId: `e2e-${nanoid(12)}`,
          totals: { ourScore: "100", opponentScore: "50" },
          reportedOutcome: null,
          finality: "final",
          scope: week.scope,
        },
      },
    );
    expect(dayRes.ok(), await dayRes.text()).toBeTruthy();

    const matched = await fetchWeek(request, cookieHeader, pastWeek);
    const check = matched.memberScoreChecks?.[scoreDate];
    expect(check?.status).toBe("match");

    await sql`
      UPDATE vs_score_heads SET score = 30
      WHERE alliance_id = ${alliance.allianceId}
        AND member_id = ${memberB.ashedMemberId}
        AND recorded_date = ${scoreDate}
    `;
    const mismatched = await fetchWeek(request, cookieHeader, pastWeek);
    const gap = mismatched.memberScoreChecks?.[scoreDate];
    expect(gap?.status).toBe("shortfall");
    expect(gap?.difference).toBe("10");
  });
});

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

test.describe("VS Ashed sync and capture UI", () => {
  test("week entry pulls opponent info for a connected officer", async ({
    page,
    request,
  }) => {
    const { auth, cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    mockState.records = [metaRecord(pastWeek, externalId)];
    await page.context().addCookies(playwrightAuthCookies(auth));

    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const results = page.getByTestId("vs-matchup-results").locator("visible=true");
    await expect(results.getByText("Opponent").first()).toBeVisible();
    await expect(
      page.getByTestId("vs-sync-status").first(),
    ).toContainText("Synced with Ashed.");
    expect(cookieHeader).toBeTruthy();
  });

  test("daily screenshot upload reviews and saves an unfinished duel without inventing wins", async ({
    page,
    request,
  }) => {
    const { alliance, auth } = await setupAshedAlliance(request, "officer");
    const sql = getE2eSql();
    await sql`UPDATE alliances SET tag = 'LFgo' WHERE id = ${alliance.allianceId}`;
    await sql`UPDATE sessions SET alliance_tag = 'LFgo' WHERE id = ${auth.sessionId}`;
    await page.context().addCookies(playwrightAuthCookies(auth));

    await page.goto("/en-US/vs-performance");
    await page.getByTestId("vs-capture-open").first().click();
    const dialog = page.getByTestId("vs-capture-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("vs-capture-kind").selectOption("daily_totals");
    await dialog
      .getByTestId("vs-capture-file")
      .setInputFiles(
        path.resolve(
          __dirname,
          "../src/lib/vs-performance/fixtures/vs-daily-totals-redacted.png",
        ),
      );
    await dialog.getByTestId("vs-capture-read").click();
    await expect(page.getByTestId("vs-capture-review")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("vs-capture-confirm-sides").check();
    await page.getByTestId("vs-capture-left-score").fill("0");
    await page.getByTestId("vs-capture-right-score").fill("0");
    await page.getByTestId("vs-capture-save").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const results = page.getByTestId("vs-matchup-results").locator("visible=true");
    await expect(
      results.getByText("Won", { exact: true }),
    ).toHaveCount(0);
  });

  test("member sees persisted data but no capture or sync controls", async ({
    page,
    request,
  }) => {
    const { auth, cookieHeader } = await setupAshedAlliance(
      request,
      "member",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = await fetchWeek(request, cookieHeader, pastWeek);
    expect(week.canEdit).toBe(false);
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    await expect(
      page.getByRole("heading", { name: "Weekly VS plan" }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("vs-capture-open")).toHaveCount(0);
    await expect(page.getByTestId("vs-sync-action")).toHaveCount(0);
  });

  test("pt-BR renders localized sync and capture copy", async ({
    page,
    request,
  }) => {
    const { auth, externalId } = await setupAshedAlliance(request, "officer");
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    mockState.records = [metaRecord(pastWeek, externalId)];
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/pt-BR/vs-performance?week=${pastWeek}`);
    await expect(
      page.getByTestId("vs-sync-status").first(),
    ).toContainText("Sincronizado com o Ashed.");
    await expect(
      page.getByTestId("vs-capture-open").first(),
    ).toContainText("Enviar captura de tela do VS");
  });

  test("a local metadata save stays saved when the Ashed read fails", async ({
    page,
    request,
  }) => {
    const { auth, cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    mockState.records = [metaRecord(pastWeek, externalId)];
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const results = page
      .getByTestId("vs-matchup-results")
      .locator("visible=true");
    await expect(results.getByText("Opponent").first()).toBeVisible();

    const historyResponse = page.waitForResponse(
      "**/api/vs-performance/matchup/opponents**",
    );
    await page
      .getByRole("button", { name: "Opponent alliance name", exact: true })
      .locator("visible=true")
      .click();
    await historyResponse;
    mockState.metaGetErrorStatus = 500;
    await page
      .getByLabel("Opponent alliance name", { exact: true })
      .fill("HQ Renamed");
    const patchResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/vs-performance/matchup") &&
        res.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save", exact: true })
      .locator("visible=true")
      .click();
    const patchRes = await patchResponse;
    expect(patchRes.status()).toBe(200);
    const patchBody = (await patchRes.json()) as {
      opponentName: string | null;
      week: VsWeekPayload;
    };
    expect(patchBody.opponentName).toBe("HQ Renamed");
    expect(patchBody.week.matchup?.sync?.status).toBe("failed");
    const status = page
      .getByTestId("vs-sync-status")
      .locator("visible=true");
    await expect(status).toContainText(
      "Saved in HQ, but Ashed sync failed. Retry to sync.",
    );
    await expect(status).toBeInViewport();
    await expect(
      page.getByTestId("vs-sync-action").locator("visible=true"),
    ).toBeEnabled();
    const persisted = await fetchWeek(request, cookieHeader, pastWeek);
    expect(persisted.matchup?.opponentName).toBe("HQ Renamed");
  });

  test("previous opponent history stays usable when the Ashed read fails", async ({
    page,
    request,
  }) => {
    const { auth, cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    mockState.records = [metaRecord(pastWeek, externalId)];
    const seeded = await fetchWeek(request, cookieHeader, pastWeek);
    const patchRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Local Foe",
        opponentTag: "LFO",
        opponentServer: 1234,
        expectedVersion: seeded.matchup?.version ?? 0,
        scope: seeded.scope,
      },
    });
    expect(patchRes.ok(), await patchRes.text()).toBeTruthy();
    mockState.metaGetErrorStatus = 500;

    let historyCalls = 0;
    let historyFails = false;
    await page.route("**/api/vs-performance/matchup/opponents**", (route) => {
      historyCalls += 1;
      if (historyFails) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "load" }),
        });
      }
      return route.continue();
    });
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const results = page
      .getByTestId("vs-matchup-results")
      .locator("visible=true");
    await expect(results.getByText("Local Foe").first()).toBeVisible();

    const firstHistory = page.waitForResponse(
      "**/api/vs-performance/matchup/opponents**",
    );
    await page
      .getByRole("button", { name: "Opponent alliance name", exact: true })
      .locator("visible=true")
      .click();
    const historyRes = await firstHistory;
    expect(historyRes.status()).toBe(200);
    const historyBody = (await historyRes.json()) as {
      opponents: Array<{
        server: number | null;
        tag: string | null;
        name: string | null;
      }>;
      ashedUnavailable?: boolean;
    };
    expect(historyBody.ashedUnavailable).toBe(true);
    expect(historyBody.opponents).toContainEqual(
      expect.objectContaining({
        name: "Local Foe",
        tag: "LFO",
        server: 1234,
      }),
    );
    await expect(
      page.getByTestId("vs-matchup-previous").locator("visible=true"),
    ).toContainText("Local Foe");
    const identityError = page
      .getByTestId("vs-matchup-identity-error")
      .locator("visible=true");
    await expect(identityError).toContainText(
      "Could not load matchup details from Ashed",
    );
    await expect(identityError).toBeInViewport();

    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .locator("visible=true")
      .click();
    const secondHistory = page.waitForResponse(
      "**/api/vs-performance/matchup/opponents**",
    );
    await page
      .getByRole("button", { name: "Opponent alliance name", exact: true })
      .locator("visible=true")
      .click();
    await secondHistory;
    expect(historyCalls).toBe(2);
    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .locator("visible=true")
      .click();

    historyFails = true;
    const thirdHistory = page.waitForResponse(
      "**/api/vs-performance/matchup/opponents**",
    );
    await page
      .getByRole("button", { name: "Opponent alliance name", exact: true })
      .locator("visible=true")
      .click();
    const thirdRes = await thirdHistory;
    expect(thirdRes.status()).toBe(500);
    expect(historyCalls).toBe(3);
    const loadError = page
      .getByTestId("vs-matchup-identity-error")
      .locator("visible=true");
    await expect(loadError).toContainText("Could not load");
    await expect(loadError).not.toContainText("Could not save");
    await expect(loadError).toBeInViewport();
    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .locator("visible=true")
      .click();
  });

  test("an expired credential state shows the connect action beside sync controls", async ({
    page,
    request,
  }) => {
    const { auth, cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    mockState.records = [metaRecord(pastWeek, externalId)];
    const seeded = await fetchWeek(request, cookieHeader, pastWeek);
    const patchRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentServer: 1236,
        expectedVersion: seeded.matchup?.version ?? 0,
        scope: seeded.scope,
      },
    });
    expect(patchRes.ok(), await patchRes.text()).toBeTruthy();
    const week = await fetchWeek(request, cookieHeader, pastWeek);
    expect(week.canImportAshed).toBe(true);
    expect(week.matchup).not.toBeNull();

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const syncAction = page
      .getByTestId("vs-sync-action")
      .locator("visible=true");
    await expect(syncAction).toBeEnabled();
    mockState.metaGetErrorStatus = 403;
    const syncResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/vs-performance/matchup/sync") &&
        res.request().method() === "POST",
    );
    await syncAction.click();
    await syncResponse;
    await expect(
      page.getByTestId("vs-sync-status").locator("visible=true"),
    ).toContainText(
      "Connect an authorized Ashed account to sync opponent information.",
    );
    await expect(
      page.getByTestId("vs-sync-connect").locator("visible=true"),
    ).toBeVisible();
    await expect(syncAction).toBeEnabled();
  });

  test("the legacy conflict notice uses HQ warning tokens in both themes", async ({
    page,
    request,
  }) => {
    const { auth, cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const currentWeek = getWeekStartMonday(todayLocalDate());
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    mockState.records = [metaRecord(pastWeek, externalId)];
    const seeded = await fetchWeek(request, cookieHeader, pastWeek);
    const patchRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Theme Conflict Foe",
        opponentTag: "TCF",
        opponentServer: 1234,
        expectedVersion: seeded.matchup?.version ?? 0,
        scope: seeded.scope,
      },
    });
    expect(patchRes.ok(), await patchRes.text()).toBeTruthy();
    const week = await fetchWeek(request, cookieHeader, pastWeek);
    expect(week.matchup).not.toBeNull();
    const themed: VsWeekPayload = {
      ...week,
      matchup: {
        ...week.matchup!,
        conflicts: [
          {
            id: "theme-conflict",
            recordedDate: pastWeek,
            nativeVersion: 0,
            result: { totals: null, outcome: "lost", finality: "final" },
          },
        ],
      },
    };
    let weekGets = 0;
    await page.route("**/api/vs-performance/week**", (route) => {
      weekGets += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(themed),
      });
    });
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/en-US/vs-performance?week=${currentWeek}`);
    await expect(
      page.getByTestId("vs-matchup-results").locator("visible=true"),
    ).toBeVisible();
    await page.evaluate(
      (week) =>
        window.history.pushState({ vsThemeProbe: true }, "", `?week=${week}`),
      pastWeek,
    );
    await expect.poll(() => weekGets).toBe(1);
    await expect(
      page
        .getByTestId("vs-matchup-results")
        .locator("visible=true")
        .getByText("Theme Conflict Foe")
        .first(),
    ).toBeVisible();
    const row = page
      .getByTestId("vs-conflict-theme-conflict")
      .locator("visible=true");
    await expect(row).toBeVisible();
    expect(await row.getAttribute("class")).toContain("border-hq-warning/40");
    expect(await row.getAttribute("class")).toContain("bg-hq-warning/10");
    const header = row.locator("p").first();
    await expect(header).toHaveCSS("color", "rgb(154, 103, 0)");
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(header).toHaveCSS("color", "rgb(210, 153, 34)");
  });
});

function cookieHeaderFor(auth: {
  sessionId: string;
  nextAuthToken: string;
}): string {
  return playwrightAuthCookies({
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
  })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function setupNativeAlliance(
  roleName: "officer" | "viewer" | "member" | "data_entry" = "officer",
) {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `VN${nanoid(4)}`,
    name: "VS Native Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail(`vs-native-${roleName}`),
  );
  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: alliance.allianceId,
    roleName,
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: auth.hqUserId,
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;
  return { alliance, auth, cookieHeader: cookieHeaderFor(auth) };
}

async function pollFor<T>(
  read: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("poll timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function stageReviewRow(
  sql: Sql,
  input: {
    allianceId: string;
    hqUserId: string | null;
    kind: "weekly_overview" | "daily_totals";
    reviewId?: string;
    expiresAt?: Date;
  },
): Promise<string> {
  const reviewId = input.reviewId ?? `e2e-rev-${nanoid(12)}`;
  const candidate = {
    kind: input.kind,
    left: { server: null, tag: null, name: null },
    right: { server: null, tag: null, name: null },
    day: 2,
    leftScore: "100",
    rightScore: "50",
    leftPoints: null,
    rightPoints: null,
    dayResults: [1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      winner: "unknown",
    })),
    ongoing: false,
    partial: true,
  };
  await sql`
    INSERT INTO vs_capture_reviews (
      id, alliance_id, created_by_hq_user_id, kind, image_sha256,
      candidate, status, version, expires_at, created_at
    ) VALUES (
      ${reviewId}, ${input.allianceId}, ${input.hqUserId}, ${input.kind},
      ${`e2e-sha-${nanoid(8)}`}, ${sql.json(candidate)}, 'review', 1,
      ${input.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000)}, ${new Date()}
    )
  `;
  return reviewId;
}

function dailyReview(
  weekStart: string,
  input: {
    day?: number;
    leftScore?: string | null;
    rightScore?: string | null;
    finalDay?: boolean;
    leftTag?: string | null;
    rightTag?: string | null;
    leftServer?: number | null;
    rightServer?: number | null;
    ourSide?: "left" | "right";
  } = {},
) {
  return {
    kind: "daily_totals" as const,
    weekStart,
    ourSide: input.ourSide ?? "left",
    confirmSides: true as const,
    left: {
      server: input.leftServer ?? null,
      tag: input.leftTag ?? null,
      name: null,
    },
    right: {
      server: input.rightServer ?? null,
      tag: input.rightTag ?? "FOE",
      name: "Opponent",
    },
    day: input.day ?? 2,
    leftScore: input.leftScore === undefined ? "100" : input.leftScore,
    rightScore: input.rightScore === undefined ? "50" : input.rightScore,
    finalDay: input.finalDay ?? true,
  };
}

function weeklyReview(
  weekStart: string,
  input: {
    leftPoints?: number | null;
    rightPoints?: number | null;
    winners?: Array<"left" | "right" | "unknown">;
    leftTag?: string | null;
    rightTag?: string | null;
    leftServer?: number | null;
    rightServer?: number | null;
    ourSide?: "left" | "right";
  } = {},
) {
  return {
    kind: "weekly_overview" as const,
    weekStart,
    ourSide: input.ourSide ?? "left",
    confirmSides: true as const,
    left: {
      server: input.leftServer ?? null,
      tag: input.leftTag ?? null,
      name: null,
    },
    right: {
      server: input.rightServer ?? null,
      tag: input.rightTag ?? "FOE",
      name: "Opponent",
    },
    leftPoints: input.leftPoints ?? null,
    rightPoints: input.rightPoints ?? null,
    dayResults: (input.winners ?? Array(6).fill("unknown")).map(
      (winner, index) => ({ day: index + 1, winner }),
    ),
  };
}

async function commitCapture(
  request: APIRequestContext,
  cookieHeader: string,
  reviewId: string,
  body: Record<string, unknown>,
) {
  return request.post(`/api/vs-performance/captures/${reviewId}/commit`, {
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    data: body,
  });
}

test.describe("VS capture commit transaction integrity", () => {
  test("the same staged review cannot commit to two different weeks concurrently", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, auth, cookieHeader } = await setupNativeAlliance();
    const reviewId = await stageReviewRow(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      kind: "daily_totals",
    });
    const today = todayLocalDate();
    const weekA = getWeekStartMonday(addCalendarDays(today, -7));
    const weekB = getWeekStartMonday(addCalendarDays(today, -14));
    const payloadA = await fetchWeek(request, cookieHeader, weekA);
    const payloadB = await fetchWeek(request, cookieHeader, weekB);

    const reviewFor = (weekStart: string) =>
      dailyReview(weekStart, {
        day: 2,
        leftTag: alliance.tag,
      });
    const bodyFor = (weekStart: string, scope: string) => ({
      review: reviewFor(weekStart),
      expectedReviewVersion: 1,
      expectedMatchupVersion: 0,
      expectedDayVersions: { [addCalendarDays(weekStart, 1)]: 0 },
      requestId: `e2e-req-${nanoid(10)}`,
      scope,
    });

    const [resA, resB] = await Promise.all([
      commitCapture(
        request,
        cookieHeader,
        reviewId,
        bodyFor(weekA, payloadA.scope),
      ),
      commitCapture(
        request,
        cookieHeader,
        reviewId,
        bodyFor(weekB, payloadB.scope),
      ),
    ]);

    const statuses = [resA.status(), resB.status()].sort();
    expect(statuses).toEqual([200, 409]);

    const matchups = await sql<{ week_start: string }[]>`
      SELECT week_start FROM vs_matchups
      WHERE alliance_id = ${alliance.allianceId}
    `;
    expect(matchups).toHaveLength(1);
    const winningWeek = resA.status() === 200 ? weekA : weekB;
    expect(matchups[0]!.week_start).toBe(winningWeek);
    const days = await sql<{ recorded_date: string }[]>`
      SELECT d.recorded_date FROM vs_match_day_results d
      JOIN vs_matchups m ON m.id = d.matchup_id
      WHERE m.alliance_id = ${alliance.allianceId}
    `;
    expect(days).toHaveLength(1);
    const [review] = await sql<
      { status: string; completed_request_id: string | null }[]
    >`
      SELECT status, completed_request_id FROM vs_capture_reviews
      WHERE id = ${reviewId}
    `;
    expect(review?.status).toBe("complete");
    expect(review?.completed_request_id).toBeTruthy();
  });

  test("concurrent identical replay returns one durable result and denials hold", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, auth, cookieHeader } = await setupNativeAlliance();
    const reviewId = await stageReviewRow(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      kind: "daily_totals",
    });
    const today = todayLocalDate();
    const weekStart = getWeekStartMonday(addCalendarDays(today, -7));
    const payload = await fetchWeek(request, cookieHeader, weekStart);
    const recordedDate = addCalendarDays(weekStart, 1);
    const body = {
      review: dailyReview(weekStart, { day: 2, leftTag: alliance.tag }),
      expectedReviewVersion: 1,
      expectedMatchupVersion: 0,
      expectedDayVersions: { [recordedDate]: 0 },
      requestId: `e2e-req-${nanoid(10)}`,
      scope: payload.scope,
    };

    const [first, second] = await Promise.all([
      commitCapture(request, cookieHeader, reviewId, body),
      commitCapture(request, cookieHeader, reviewId, body),
    ]);
    expect(first.status(), await first.text()).toBe(200);
    expect(second.status(), await second.text()).toBe(200);
    const firstPayload = (await first.json()) as VsWeekPayload;
    const secondPayload = (await second.json()) as VsWeekPayload;
    expect(firstPayload.weekStart).toBe(weekStart);
    expect(secondPayload.weekStart).toBe(weekStart);
    expect(firstPayload.matchup?.days).toHaveLength(1);

    const observations = await sql<{ id: string }[]>`
      SELECT o.id FROM vs_match_observations o
      JOIN vs_matchups m ON m.id = o.matchup_id
      WHERE m.alliance_id = ${alliance.allianceId}
    `;
    expect(observations).toHaveLength(1);

    const matchupId = firstPayload.matchup!.id;
    const dayEdit = await request.patch(
      `/api/vs-performance/matchup/days/${recordedDate}`,
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          matchupId,
          expectedVersion: firstPayload.matchup!.days[0]!.version,
          requestId: `e2e-edit-${nanoid(10)}`,
          totals: { ourScore: "111", opponentScore: "50" },
          reportedOutcome: null,
          finality: "final",
          scope: payload.scope,
        },
      },
    );
    expect(dayEdit.ok(), await dayEdit.text()).toBeTruthy();

    const replay = await commitCapture(request, cookieHeader, reviewId, body);
    expect(replay.status()).toBe(200);
    const replayed = (await replay.json()) as VsWeekPayload;
    const head = replayed.matchup?.days.find(
      (day) => day.recordedDate === recordedDate,
    );
    expect(head?.totals?.ourScore).toBe("111");

    const other = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("vs-other-officer"),
    );
    await createAllianceMembership(sql, {
      hqUserId: other.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${other.sessionId}
    `;
    const otherCookie = cookieHeaderFor(other);
    const otherWeek = await fetchWeek(request, otherCookie, weekStart);
    const foreignReview = await stageReviewRow(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      kind: "daily_totals",
    });
    const wrongOwner = await commitCapture(
      request,
      otherCookie,
      foreignReview,
      {
        ...body,
        scope: otherWeek.scope,
      },
    );
    expect(wrongOwner.status()).toBe(400);
    expect((await wrongOwner.json()).code).toBe("capture_invalid");
    const completedWrongOwner = await commitCapture(
      request,
      otherCookie,
      reviewId,
      { ...body, scope: otherWeek.scope },
    );
    expect(completedWrongOwner.status()).toBe(400);
    expect((await completedWrongOwner.json()).code).toBe("capture_invalid");

    const foreign = await setupNativeAlliance();
    const foreignWeek = await fetchWeek(request, foreign.cookieHeader, weekStart);
    const foreignTenant = await commitCapture(
      request,
      foreign.cookieHeader,
      foreignReview,
      { ...body, scope: foreignWeek.scope },
    );
    expect(foreignTenant.status()).toBe(400);
    expect((await foreignTenant.json()).code).toBe("capture_invalid");

    const cases: Array<{
      name: string;
      status: number;
      code: string;
      mutate?: (draft: Record<string, unknown>) => void;
      expiresAt?: Date;
      kind?: "weekly_overview" | "daily_totals";
    }> = [
      {
        name: "expired",
        status: 400,
        code: "capture_invalid",
        expiresAt: new Date(Date.now() - 60_000),
      },
      {
        name: "kind mismatch",
        status: 400,
        code: "capture_invalid",
        kind: "weekly_overview",
        mutate: (draft) => {
          draft.review = dailyReview(weekStart, {
            day: 2,
            leftTag: alliance.tag,
          });
        },
      },
      {
        name: "stale review version",
        status: 400,
        code: "capture_invalid",
        mutate: (draft) => {
          draft.expectedReviewVersion = 2;
        },
      },
      {
        name: "stale matchup version",
        status: 409,
        code: "stale",
        mutate: (draft) => {
          draft.expectedMatchupVersion = 9;
        },
      },
      {
        name: "missing day version",
        status: 400,
        code: "capture_invalid",
        mutate: (draft) => {
          draft.expectedDayVersions = {};
        },
      },
    ];
    for (const deniedCase of cases) {
      const deniedId = await stageReviewRow(sql, {
        allianceId: alliance.allianceId,
        hqUserId: auth.hqUserId,
        kind: deniedCase.kind ?? "daily_totals",
        expiresAt: deniedCase.expiresAt,
      });
      const fresh = await fetchWeek(request, cookieHeader, weekStart);
      const freshHead = fresh.matchup?.days.find(
        (day) => day.recordedDate === recordedDate,
      );
      const draft: Record<string, unknown> = {
        ...body,
        requestId: `e2e-req-${nanoid(10)}`,
        expectedMatchupVersion: fresh.matchup?.version ?? 0,
        expectedDayVersions: { [recordedDate]: freshHead?.version ?? 0 },
      };
      deniedCase.mutate?.(draft);
      const res = await commitCapture(
        request,
        cookieHeader,
        deniedId,
        draft,
      );
      expect(res.status(), deniedCase.name).toBe(deniedCase.status);
      expect((await res.json()).code, deniedCase.name).toBe(deniedCase.code);
      const [row] = await sql<{ status: string }[]>`
        SELECT status FROM vs_capture_reviews WHERE id = ${deniedId}
      `;
      expect(row?.status, deniedCase.name).toBe("review");
    }
  });

  test("a mid-transaction failure rolls back heads, observations, and review consumption", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, auth, cookieHeader } = await setupAshedAlliance(
      request,
      "officer",
    );
    const today = todayLocalDate();
    const weekStart = getWeekStartMonday(addCalendarDays(today, -7));
    const recordedDate = addCalendarDays(weekStart, 1);
    const reviewId = `e2e-rollback-${nanoid(10)}`;
    await stageReviewRow(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      kind: "daily_totals",
      reviewId,
    });
    const payload = await fetchWeek(request, cookieHeader, weekStart);
    const body = {
      review: dailyReview(weekStart, {
        day: 2,
        leftTag: alliance.tag,
      }),
      expectedReviewVersion: 1,
      expectedMatchupVersion: 0,
      expectedDayVersions: { [recordedDate]: 0 },
      requestId: `e2e-req-${nanoid(10)}`,
      scope: payload.scope,
    };

    const constraintName = `e2e_reject_complete_${reviewId.replace(/[^a-zA-Z0-9]/g, "")}`;
    await sql.unsafe(
      `ALTER TABLE vs_capture_reviews ADD CONSTRAINT ${constraintName} CHECK (id <> '${reviewId}' OR status <> 'complete')`,
    );
    try {
      const res = await commitCapture(request, cookieHeader, reviewId, body);
      expect(res.status(), await res.text()).toBe(500);
    } finally {
      await sql.unsafe(
        `ALTER TABLE vs_capture_reviews DROP CONSTRAINT ${constraintName}`,
      );
    }

    const [review] = await sql<
      { status: string; version: number; completed_result: unknown }[]
    >`
      SELECT status, version, completed_result FROM vs_capture_reviews
      WHERE id = ${reviewId}
    `;
    expect(review?.status).toBe("review");
    expect(review?.version).toBe(1);
    expect(review?.completed_result).toBeNull();
    const matchups = await sql<{ id: string }[]>`
      SELECT id FROM vs_matchups WHERE alliance_id = ${alliance.allianceId}
    `;
    expect(matchups).toHaveLength(0);
    const days = await sql<{ id: string }[]>`
      SELECT id FROM vs_match_day_results
      WHERE alliance_id = ${alliance.allianceId}
    `;
    expect(days).toHaveLength(0);
    const observations = await sql<{ id: string }[]>`
      SELECT id FROM vs_match_observations
      WHERE alliance_id = ${alliance.allianceId}
    `;
    expect(observations).toHaveLength(0);
    const outbox = await sql<{ id: string }[]>`
      SELECT s.matchup_id FROM vs_matchup_ashed_sync s
      JOIN vs_matchups m ON m.id = s.matchup_id
      WHERE s.alliance_id = ${alliance.allianceId}
    `;
    expect(outbox).toHaveLength(0);
  });
});

test.describe("VS opponent sync resolution and lease fencing", () => {
  test("use_ashed applies reviewed remote values and moved remote 409s both resolutions", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));
    const day1 = addCalendarDays(pastWeek, 0);
    const record = metaRecord(pastWeek, externalId, {
      opponent_daily_scores: [50, 2, 3, 4, 5, 6, 0],
    });
    mockState.records = [record];

    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const importRes = await request.post(
      "/api/vs-performance/matchup/import",
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { weekStart: pastWeek, scope: week.scope, reason: "refresh" },
      },
    );
    expect(importRes.ok(), await importRes.text()).toBeTruthy();

    const imported = await fetchWeek(request, cookieHeader, pastWeek);
    const dayRes = await request.patch(
      `/api/vs-performance/matchup/days/${day1}`,
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          matchupId: imported.matchup!.id,
          expectedVersion: 0,
          requestId: `e2e-${nanoid(12)}`,
          totals: { ourScore: "100", opponentScore: "50" },
          reportedOutcome: null,
          finality: "final",
          scope: imported.scope,
        },
      },
    );
    expect(dayRes.ok(), await dayRes.text()).toBeTruthy();

    record.opponent_daily_scores = [150, 2, 3, 4, 5, 6, 0];
    record.updated_date = new Date(Date.now() + 60_000).toISOString();
    const refresh = await request.post(
      "/api/vs-performance/matchup/import",
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { weekStart: pastWeek, scope: imported.scope, reason: "refresh" },
      },
    );
    expect(refresh.ok(), await refresh.text()).toBeTruthy();
    const conflicted = (await refresh.json()) as VsWeekPayload;
    const syncView = conflicted.matchup!.sync!;
    expect(syncView.status).toBe("conflict");
    expect(syncView.conflicts.map((c) => c.field)).toContain("day:1");
    const token = syncView.conflictToken!;

    record.opponent_daily_scores = [175, 2, 3, 4, 5, 6, 0];
    record.updated_date = new Date(Date.now() + 120_000).toISOString();
    for (const resolution of ["keep_hq", "use_ashed"] as const) {
      const stale = await request.post("/api/vs-performance/matchup/sync", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          weekStart: pastWeek,
          scope: conflicted.scope,
          resolution,
          conflictToken: token,
        },
      });
      expect(stale.status(), resolution).toBe(409);
      expect(mockState.puts, resolution).toHaveLength(0);
    }

    const remoted = await fetchWeek(request, cookieHeader, pastWeek);
    const freshToken = remoted.matchup!.sync!.conflictToken!;
    expect(freshToken).not.toBe(token);

    const resolve = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        scope: remoted.scope,
        resolution: "use_ashed",
        conflictToken: freshToken,
      },
    });
    expect(resolve.ok(), await resolve.text()).toBeTruthy();
    expect(mockState.puts).toHaveLength(0);

    const after = (await resolve.json()) as VsWeekPayload;
    const head = after.matchup!.days.find(
      (day) => day.recordedDate === day1,
    )!;
    expect(head.totals).toEqual({ ourScore: "100", opponentScore: "175" });
    expect(head.outcome).toBe("lost");
    expect(head.hqConfirmed).toBe(true);
    expect(head.source).toBe("hq_manual");
    expect(after.matchup!.opponentDailyScores[0]).toBe("175");

    const [syncRow] = await sql<
      {
        status: string;
        lease_token: string | null;
        lease_expires_at: Date | null;
      }[]
    >`
      SELECT status, lease_token, lease_expires_at
      FROM vs_matchup_ashed_sync
      WHERE matchup_id = ${after.matchup!.id}
    `;
    expect(syncRow?.lease_token).toBeNull();
    expect(syncRow?.lease_expires_at).toBeNull();
    expect(syncRow?.status).toBe("synced");

    const next = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        scope: after.scope,
        reason: "sync",
      },
    });
    expect(next.status()).not.toBe(409);
  });

  test("an edit during an in-flight PUT stays pending and a later explicit sync publishes it", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));
    const record = metaRecord(pastWeek, externalId);
    mockState.records = [record];

    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const importRes = await request.post(
      "/api/vs-performance/matchup/import",
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { weekStart: pastWeek, scope: week.scope },
      },
    );
    expect(importRes.ok()).toBeTruthy();
    const imported = await fetchWeek(request, cookieHeader, pastWeek);
    const matchupId = imported.matchup!.id;

    mockState.gateMetaPut = true;
    const firstSave = request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentScores: [{ day: 2, score: "99" }],
        expectedVersion: imported.matchup!.version,
        scope: imported.scope,
      },
    });
    await pollFor(async () =>
      mockState.pendingMetaPuts.length > 0 ? true : null,
    );

    const mid = await fetchWeek(request, cookieHeader, pastWeek);
    const publishedVersion = mid.matchup!.version;
    const secondSave = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentScores: [{ day: 2, score: "100" }],
        expectedVersion: publishedVersion,
        scope: mid.scope,
      },
    });
    expect(secondSave.ok(), await secondSave.text()).toBeTruthy();

    releaseHeldRequests(mockState.pendingMetaPuts);
    mockState.gateMetaPut = false;
    const firstRes = await firstSave;
    expect(firstRes.ok(), await firstRes.text()).toBeTruthy();

    const remoteScores = record.opponent_daily_scores as number[];
    expect(remoteScores[1]).toBe(99);
    expect(mockState.puts).toHaveLength(1);

    const [syncRow] = await sql<
      {
        status: string;
        dirty_fields: string[];
        processed_version: number;
      }[]
    >`
      SELECT status, dirty_fields, processed_version
      FROM vs_matchup_ashed_sync WHERE matchup_id = ${matchupId}
    `;
    expect(syncRow?.status).toBe("pending");
    expect(syncRow?.dirty_fields).toContain("day:2");
    expect(syncRow?.processed_version).toBe(publishedVersion);

    const local = await fetchWeek(request, cookieHeader, pastWeek);
    expect(local.matchup!.opponentDailyScores[1]).toBe("100");

    const explicit = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: local.scope, reason: "sync" },
    });
    expect(explicit.ok(), await explicit.text()).toBeTruthy();
    expect(mockState.puts).toHaveLength(2);
    expect(
      (mockState.puts[1]!.body.opponent_daily_scores as number[])[1],
    ).toBe(100);
    const done = (await explicit.json()) as VsWeekPayload;
    expect(done.matchup!.sync!.status).toBe("synced");
  });

  test("an expired lease cannot be cleared or finished by the older request", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));
    mockState.records = [metaRecord(pastWeek, externalId)];

    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const importRes = await request.post(
      "/api/vs-performance/matchup/import",
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { weekStart: pastWeek, scope: week.scope },
      },
    );
    expect(importRes.ok()).toBeTruthy();
    const imported = await fetchWeek(request, cookieHeader, pastWeek);
    const matchupId = imported.matchup!.id;

    mockState.holdMetaGets = 2;
    const syncA = request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: imported.scope, reason: "sync" },
    });
    const tokenA = await pollFor(async () => {
      const [row] = await sql<{ lease_token: string | null }[]>`
        SELECT lease_token FROM vs_matchup_ashed_sync
        WHERE matchup_id = ${matchupId}
      `;
      return row?.lease_token ?? null;
    });

    await sql`
      UPDATE vs_matchup_ashed_sync
      SET lease_expires_at = ${new Date(Date.now() - 60_000)}
      WHERE matchup_id = ${matchupId}
    `;

    const syncB = request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: imported.scope, reason: "sync" },
    });
    const tokenB = await pollFor(async () => {
      const [row] = await sql<{ lease_token: string | null }[]>`
        SELECT lease_token FROM vs_matchup_ashed_sync
        WHERE matchup_id = ${matchupId}
      `;
      return row?.lease_token && row.lease_token !== tokenA
        ? row.lease_token
        : null;
    });
    expect(tokenB).not.toBe(tokenA);
    await pollFor(async () =>
      mockState.pendingMetaGets.length >= 2 ? true : null,
    );

    const [bState] = await sql<
      { baseline_snapshot: unknown; external_competition_id: string | null }[]
    >`
      SELECT s.baseline_snapshot, m.external_competition_id
      FROM vs_matchup_ashed_sync s
      JOIN vs_matchups m ON m.id = s.matchup_id AND m.alliance_id = s.alliance_id
      WHERE s.matchup_id = ${matchupId}
    `;

    mockState.pendingMetaGets[0]!();
    const resA = await syncA;
    expect([200, 409]).toContain(resA.status());
    const [midRow] = await sql<
      {
        lease_token: string | null;
        baseline_snapshot: unknown;
        external_competition_id: string | null;
      }[]
    >`
      SELECT s.lease_token, s.baseline_snapshot, m.external_competition_id
      FROM vs_matchup_ashed_sync s
      JOIN vs_matchups m ON m.id = s.matchup_id AND m.alliance_id = s.alliance_id
      WHERE s.matchup_id = ${matchupId}
    `;
    expect(midRow?.lease_token).toBe(tokenB);
    expect(midRow?.baseline_snapshot).toEqual(bState?.baseline_snapshot);
    expect(midRow?.external_competition_id).toBe(
      bState?.external_competition_id,
    );

    releaseHeldRequests(mockState.pendingMetaGets);
    const resB = await syncB;
    expect(resB.ok(), await resB.text()).toBeTruthy();
    const [finalRow] = await sql<
      {
        status: string;
        lease_token: string | null;
        baseline_snapshot: unknown;
      }[]
    >`
      SELECT status, lease_token, baseline_snapshot
      FROM vs_matchup_ashed_sync WHERE matchup_id = ${matchupId}
    `;
    expect(finalRow?.lease_token).toBeNull();
    expect(finalRow?.baseline_snapshot).not.toBeNull();
  });
});

test.describe("VS uncertain create protocol", () => {
  test("a failed POST never retries implicitly; readback binds instead", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { cookieHeader } = await setupAshedAlliance(request, "officer");
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));

    mockState.postBehavior = "apply-then-500";
    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const save = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe Alliance",
        opponentTag: "FOE",
        opponentServer: 1236,
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    expect(save.ok(), await save.text()).toBeTruthy();
    expect(mockState.posts).toHaveLength(1);
    const created = mockState.records.find(
      (row) => row.competition_date === pastWeek,
    );
    expect(created).toBeTruthy();

    const uncertain = await fetchWeek(request, cookieHeader, pastWeek);
    expect(uncertain.matchup?.sync?.status).toBe("uncertain");

    mockState.postBehavior = "ok";
    const recover = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: uncertain.scope, reason: "sync" },
    });
    expect(recover.ok(), await recover.text()).toBeTruthy();
    expect(mockState.posts).toHaveLength(1);
    const recovered = (await recover.json()) as VsWeekPayload;
    expect(recovered.matchup?.sync?.status).toBe("synced");
    const [bound] = await sql<{ external_competition_id: string | null }[]>`
      SELECT external_competition_id FROM vs_matchups
      WHERE id = ${recovered.matchup!.id}
    `;
    expect(bound?.external_competition_id).toBe(created!.id);
  });

  test("absent readback requires explicit refresh then explicit sync to rearm create", async ({
    request,
  }) => {
    const { cookieHeader } = await setupAshedAlliance(request, "officer");
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));

    mockState.postBehavior = "apply-then-500";
    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const save = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe Alliance",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    expect(save.ok(), await save.text()).toBeTruthy();
    expect(mockState.posts).toHaveLength(1);
    mockState.records = mockState.records.filter(
      (row) => row.competition_date !== pastWeek,
    );

    mockState.metaGetErrorStatus = 500;
    const failedRead = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: week.scope, reason: "auto" },
    });
    expect(failedRead.ok(), await failedRead.text()).toBeTruthy();
    const sticky = (await failedRead.json()) as VsWeekPayload;
    expect(sticky.matchup?.sync?.status).toBe("uncertain");
    mockState.metaGetErrorStatus = null;

    const auto = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: sticky.scope, reason: "auto" },
    });
    expect(auto.ok(), await auto.text()).toBeTruthy();
    expect(mockState.posts).toHaveLength(1);
    const stillUncertain = (await auto.json()) as VsWeekPayload;
    expect(stillUncertain.matchup?.sync?.status).toBe("uncertain");

    const refresh = await request.post(
      "/api/vs-performance/matchup/import",
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          weekStart: pastWeek,
          scope: stillUncertain.scope,
          reason: "refresh",
        },
      },
    );
    expect(refresh.ok(), await refresh.text()).toBeTruthy();
    const rearmed = (await refresh.json()) as VsWeekPayload;
    expect(rearmed.matchup?.sync?.status).toBe("pending");
    expect(mockState.posts).toHaveLength(1);

    const autoAgain = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: rearmed.scope, reason: "auto" },
    });
    expect(autoAgain.ok(), await autoAgain.text()).toBeTruthy();
    expect(mockState.posts).toHaveLength(1);

    mockState.postBehavior = "ok";
    const explicit = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: rearmed.scope, reason: "sync" },
    });
    expect(explicit.ok(), await explicit.text()).toBeTruthy();
    expect(mockState.posts).toHaveLength(2);
    const synced = (await explicit.json()) as VsWeekPayload;
    expect(synced.matchup?.sync?.status).toBe("synced");
  });

  test("a readback with wrong values or duplicate weeks never binds implicitly", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { cookieHeader, externalId } = await setupAshedAlliance(
      request,
      "officer",
    );
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));

    mockState.postBehavior = "apply-then-500";
    const week = await fetchWeek(request, cookieHeader, pastWeek);
    const save = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe Alliance",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    expect(save.ok(), await save.text()).toBeTruthy();
    expect(mockState.posts).toHaveLength(1);
    mockState.postBehavior = "ok";

    const created = mockState.records.find(
      (row) => row.competition_date === pastWeek,
    )!;
    created.opponent_daily_scores = [7, 7, 7, 7, 7, 7, 0];

    const wrong = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: week.scope, reason: "sync" },
    });
    expect(wrong.ok(), await wrong.text()).toBeTruthy();
    const wrongPayload = (await wrong.json()) as VsWeekPayload;
    expect(wrongPayload.matchup?.sync?.status).toBe("conflict");
    expect(mockState.posts).toHaveLength(1);
    const [unbound] = await sql<{ external_competition_id: string | null }[]>`
      SELECT external_competition_id FROM vs_matchups
      WHERE id = ${wrongPayload.matchup!.id}
    `;
    expect(unbound?.external_competition_id).toBeNull();

    mockState.records.push(
      metaRecord(pastWeek, externalId, { opponent_tag: "DUP" }),
    );
    const dup = await request.post("/api/vs-performance/matchup/sync", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: pastWeek, scope: wrongPayload.scope, reason: "sync" },
    });
    expect(dup.ok(), await dup.text()).toBeTruthy();
    const dupPayload = (await dup.json()) as VsWeekPayload;
    expect(dupPayload.matchup?.sync?.status).toBe("conflict");
    expect(mockState.posts).toHaveLength(1);
    expect(mockState.puts).toHaveLength(0);
  });
});

test.describe("VS sync privilege and credential boundaries", () => {
  test("bootstrap, member, and data_entry sessions are denied sync mutations", async ({
    request,
  }) => {
    const bootstrap = await request.get("/api/auth/bootstrap?next=/", {
      maxRedirects: 0,
    });
    const setCookie = bootstrap.headers()["set-cookie"] ?? "";
    const match = /alliance_hq_session=([^;]+)/.exec(setCookie);
    expect(match).toBeTruthy();
    const bootstrapCookie = `alliance_hq_session=${match![1]}`;

    const { cookieHeader } = await setupAshedAlliance(request, "officer");
    const week = await fetchWeek(request, cookieHeader);
    const bodies: Array<[string, unknown]> = [
      [
        "/api/vs-performance/matchup/import",
        { weekStart: week.weekStart, scope: week.scope },
      ],
      [
        "/api/vs-performance/matchup/sync",
        { weekStart: week.weekStart, scope: week.scope },
      ],
      [
        "/api/vs-performance/captures/some-review/commit",
        {
          review: {},
          expectedReviewVersion: 1,
          expectedMatchupVersion: 0,
          expectedDayVersions: {},
          requestId: "e2e-x",
          scope: week.scope,
        },
      ],
    ];
    for (const [url, data] of bodies) {
      const res = await request.post(url, {
        headers: { Cookie: bootstrapCookie, "Content-Type": "application/json" },
        data,
      });
      expect(res.status(), url).toBe(403);
    }
    const parseRes = await request.post("/api/vs-performance/captures/parse", {
      headers: { Cookie: bootstrapCookie },
      multipart: {
        image: {
          name: "x.png",
          mimeType: "image/png",
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        },
        kind: "daily_totals",
        weekStart: week.weekStart,
        scope: week.scope,
      },
    });
    expect(parseRes.status()).toBe(403);

    for (const role of ["member", "data_entry"] as const) {
      const scoped = await setupAshedAlliance(request, role);
      const deniedWeek = await fetchWeek(request, scoped.cookieHeader);
      const importRes = await request.post(
        "/api/vs-performance/matchup/import",
        {
          headers: {
            Cookie: scoped.cookieHeader,
            "Content-Type": "application/json",
          },
          data: {
            weekStart: deniedWeek.weekStart,
            scope: deniedWeek.scope,
          },
        },
      );
      expect(importRes.status(), role).toBe(403);
      const syncRes = await request.post("/api/vs-performance/matchup/sync", {
        headers: {
          Cookie: scoped.cookieHeader,
          "Content-Type": "application/json",
        },
        data: {
          weekStart: deniedWeek.weekStart,
          scope: deniedWeek.scope,
        },
      });
      expect(syncRes.status(), role).toBe(403);
      const parseDenied = await request.post(
        "/api/vs-performance/captures/parse",
        {
          headers: { Cookie: scoped.cookieHeader },
          multipart: {
            image: {
              name: "x.png",
              mimeType: "image/png",
              buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            },
            kind: "daily_totals",
            weekStart: deniedWeek.weekStart,
            scope: deniedWeek.scope,
          },
        },
      );
      expect(parseDenied.status(), role).toBe(403);
    }
  });

  test("a delegated share without data_management:write blocks sync without bot fallback", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, auth, cookieHeader, externalId } =
      await setupAshedAlliance(request, "officer");
    const owner = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("vs-share-owner"),
    );
    const now = new Date();
    await sql`
      INSERT INTO ashed_credential_shares (
        id, alliance_id, owner_hq_user_id, delegate_hq_user_id,
        invited_hq_user_id, status, capabilities, encrypted_token,
        app_id, origin_url, token_expires_at, ashed_user_id,
        expires_at, accepted_at, created_at, updated_at
      ) VALUES (
        ${`share-${nanoid(12)}`}, ${alliance.allianceId}, ${owner.hqUserId},
        ${auth.hqUserId}, ${owner.hqUserId}, 'active',
        ${sql.json(["roster:sync"])}, ${encryptSecret("e2e-delegated-token")},
        ${DEFAULT_APP_ID}, ${DEFAULT_ORIGIN_URL},
        ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}, ${"ashed-delegate-e2e"},
        ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}, ${now}, ${now}, ${now}
      )
    `;
    await sql`
      INSERT INTO alliance_ashed_credentials (
        id, alliance_id, app_id, origin_url, encrypted_token,
        token_expires_at, created_at, updated_at
      ) VALUES (
        ${`cred-${nanoid(12)}`}, ${alliance.allianceId}, ${DEFAULT_APP_ID},
        ${DEFAULT_ORIGIN_URL}, ${encryptSecret("e2e-installed-token")},
        ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}, ${now}, ${now}
      )
    `;
    await sql`
      DELETE FROM ashed_credentials WHERE session_id = ${auth.sessionId}
    `;
    await sql`
      UPDATE hq_users SET ashed_user_id = NULL WHERE id = ${auth.hqUserId}
    `;

    const week = await fetchWeek(request, cookieHeader);
    const res = await request.post("/api/vs-performance/matchup/import", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: week.weekStart, scope: week.scope },
    });
    expect(res.status()).toBe(200);
    const payload = (await res.json()) as VsWeekPayload;
    expect(payload.matchup?.sync?.status).toBe("credentials_required");
    expect(mockState.posts).toHaveLength(0);
    expect(mockState.puts).toHaveLength(0);
    expect(mockState.metaGetCount).toBe(0);
    void externalId;
  });
});

test.describe("VS capture parsing and merge matrix", () => {
  test("the real daily fixture parses the ongoing duel without invented wins", async ({
    request,
  }) => {
    const { cookieHeader } = await setupAshedAlliance(request, "officer");
    const week = await fetchWeek(request, cookieHeader);
    const res = await request.post("/api/vs-performance/captures/parse", {
      headers: { Cookie: cookieHeader },
      multipart: {
        image: {
          name: "vs-daily.png",
          mimeType: "image/png",
          buffer: readFileSync(
            path.resolve(
              __dirname,
              "../src/lib/vs-performance/fixtures/vs-daily-totals-redacted.png",
            ),
          ),
        },
        kind: "daily_totals",
        weekStart: week.weekStart,
        scope: week.scope,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const staged = (await res.json()) as {
      reviewId: string;
      candidate: {
        day: number | null;
        left: { tag: string | null };
        right: { tag: string | null };
        leftScore: string | null;
        rightScore: string | null;
        ongoing: boolean;
        dayResults: Array<{ winner: string }>;
      };
    };
    expect(staged.candidate.day).toBe(2);
    expect(staged.candidate.left.tag).toBe("LFgo");
    expect(staged.candidate.right.tag).toBe("TriV");
    expect(staged.candidate.leftScore).toBe("0");
    expect(staged.candidate.rightScore).toBe("0");
    expect(staged.candidate.ongoing).toBe(true);
    expect(
      staged.candidate.dayResults.every((day) => day.winner === "unknown"),
    ).toBe(true);
  });

  test("the real weekly fixture parses servers and points honestly", async ({
    request,
  }) => {
    const { cookieHeader } = await setupAshedAlliance(request, "officer");
    const week = await fetchWeek(request, cookieHeader);
    const res = await request.post("/api/vs-performance/captures/parse", {
      headers: { Cookie: cookieHeader },
      multipart: {
        image: {
          name: "vs-weekly.png",
          mimeType: "image/png",
          buffer: readFileSync(
            path.resolve(
              __dirname,
              "../src/lib/vs-performance/fixtures/vs-weekly-overview-redacted.png",
            ),
          ),
        },
        kind: "weekly_overview",
        weekStart: week.weekStart,
        scope: week.scope,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const staged = (await res.json()) as {
      candidate: {
        left: { server: number | null };
        right: { server: number | null };
        leftPoints: number | null;
        rightPoints: number | null;
        partial: boolean;
        dayResults: Array<{ winner: string }>;
      };
    };
    expect(staged.candidate.left.server).toBe(1203);
    expect(staged.candidate.right.server).toBe(1236);
    expect(staged.candidate.leftPoints).toBe(0);
    expect(staged.candidate.partial).toBe(true);
    expect(staged.candidate.rightPoints).toBeNull();
  });

  test("weekly header merges preserve authoritative paired totals", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, auth, cookieHeader } = await setupNativeAlliance();
    const today = todayLocalDate();
    const weekStart = getWeekStartMonday(addCalendarDays(today, -7));
    const day1 = addCalendarDays(weekStart, 0);
    const payload = await fetchWeek(request, cookieHeader, weekStart);

    const identity = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart,
        opponentName: "Foe",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: payload.scope,
      },
    });
    expect(identity.ok(), await identity.text()).toBeTruthy();
    const withMatchup = await fetchWeek(request, cookieHeader, weekStart);
    const matchupId = withMatchup.matchup!.id;

    const headRes = await request.patch(
      `/api/vs-performance/matchup/days/${day1}`,
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          matchupId,
          expectedVersion: 0,
          requestId: `e2e-${nanoid(12)}`,
          totals: { ourScore: "100", opponentScore: "50" },
          reportedOutcome: null,
          finality: "final",
          scope: withMatchup.scope,
        },
      },
    );
    expect(headRes.ok(), await headRes.text()).toBeTruthy();
    const afterHead = await fetchWeek(request, cookieHeader, weekStart);
    const headVersion = afterHead.matchup!.days[0]!.version;
    const matchupVersion = afterHead.matchup!.version;

    const stageWeekly = () =>
      stageReviewRow(sql, {
        allianceId: alliance.allianceId,
        hqUserId: auth.hqUserId,
        kind: "weekly_overview",
      });
    const winners = (day1Winner: "left" | "right" | "unknown") =>
      [day1Winner, "unknown", "unknown", "unknown", "unknown", "unknown"] as
        Array<"left" | "right" | "unknown">;

    const winReview = await stageWeekly();
    const win = await commitCapture(request, cookieHeader, winReview, {
      review: weeklyReview(weekStart, {
        leftPoints: 7,
        rightPoints: 0,
        leftServer: 1203,
        winners: winners("left"),
        leftTag: alliance.tag,
        rightTag: "FOE",
      }),
      expectedReviewVersion: 1,
      expectedMatchupVersion: matchupVersion,
      expectedDayVersions: { [day1]: headVersion },
      requestId: `e2e-${nanoid(12)}`,
      scope: afterHead.scope,
    });
    expect(win.ok(), await win.text()).toBeTruthy();
    const winPayload = (await win.json()) as VsWeekPayload;
    const winHead = winPayload.matchup!.days.find(
      (day) => day.recordedDate === day1,
    )!;
    expect(winHead.totals).toEqual({ ourScore: "100", opponentScore: "50" });
    expect(winHead.outcome).toBe("won");
    expect(winPayload.matchup!.weekOutcome).toBe("win");

    const refreshed = await fetchWeek(request, cookieHeader, weekStart);
    const loseReview = await stageWeekly();
    const lose = await commitCapture(request, cookieHeader, loseReview, {
      review: weeklyReview(weekStart, {
        leftPoints: 0,
        rightPoints: 7,
        leftServer: 1203,
        winners: winners("right"),
        leftTag: alliance.tag,
        rightTag: "FOE",
      }),
      expectedReviewVersion: 1,
      expectedMatchupVersion: refreshed.matchup!.version,
      expectedDayVersions: { [day1]: refreshed.matchup!.days[0]!.version },
      requestId: `e2e-${nanoid(12)}`,
      scope: refreshed.scope,
    });
    expect(lose.ok()).toBeFalsy();
    const unchanged = await fetchWeek(request, cookieHeader, weekStart);
    const unchangedHead = unchanged.matchup!.days.find(
      (day) => day.recordedDate === day1,
    )!;
    expect(unchangedHead.totals).toEqual({
      ourScore: "100",
      opponentScore: "50",
    });
    expect(unchangedHead.outcome).toBe("won");
  });

  test("a 0/0 weekly header is allowed and week-boundary points are enforced", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, auth, cookieHeader } = await setupNativeAlliance();
    const today = todayLocalDate();
    const pastWeek = getWeekStartMonday(addCalendarDays(today, -7));
    const payload = await fetchWeek(request, cookieHeader, pastWeek);

    const reviewId = await stageReviewRow(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      kind: "weekly_overview",
    });
    const zero = await commitCapture(request, cookieHeader, reviewId, {
      review: weeklyReview(pastWeek, {
        leftPoints: 0,
        rightPoints: 0,
        leftServer: 1203,
        leftTag: alliance.tag,
      }),
      expectedReviewVersion: 1,
      expectedMatchupVersion: 0,
      expectedDayVersions: {},
      requestId: `e2e-${nanoid(12)}`,
      scope: payload.scope,
    });
    expect(zero.ok(), await zero.text()).toBeTruthy();
    const zeroPayload = (await zero.json()) as VsWeekPayload;
    expect(zeroPayload.matchup!.reportedOurPoints).toBe(0);
    expect(zeroPayload.matchup!.reportedOpponentPoints).toBe(0);
    expect(
      zeroPayload.matchup!.days.every((day) => day.outcome !== "won"),
    ).toBe(true);
    expect(zeroPayload.matchup!.reportedPointsAt).toBeTruthy();

    const currentWeek = getWeekStartMonday(today);
    const currentPayload = await fetchWeek(
      request,
      cookieHeader,
      currentWeek,
    );
    const noDaysElapsed = currentPayload.today <= currentWeek;
    const denied = await stageReviewRow(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      kind: "weekly_overview",
    });
    const currentAttempt = await commitCapture(
      request,
      cookieHeader,
      denied,
      {
        review: weeklyReview(currentWeek, {
          leftPoints: 1,
          rightPoints: 0,
          leftServer: 1203,
          leftTag: alliance.tag,
        }),
        expectedReviewVersion: 1,
        expectedMatchupVersion: 0,
        expectedDayVersions: {},
        requestId: `e2e-${nanoid(12)}`,
        scope: currentPayload.scope,
      },
    );
    if (noDaysElapsed) {
      expect(currentAttempt.ok()).toBeFalsy();
    } else {
      expect(currentAttempt.ok(), await currentAttempt.text()).toBeTruthy();
    }

    const futureWeek = getWeekStartMonday(addCalendarDays(today, 7));
    const futurePayload = await fetchWeek(request, cookieHeader, futureWeek);
    const futureReview = await stageReviewRow(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      kind: "weekly_overview",
    });
    const futureAttempt = await commitCapture(
      request,
      cookieHeader,
      futureReview,
      {
        review: weeklyReview(futureWeek, {
          leftPoints: 7,
          rightPoints: 0,
          leftServer: 1203,
          leftTag: alliance.tag,
        }),
        expectedReviewVersion: 1,
        expectedMatchupVersion: 0,
        expectedDayVersions: {},
        requestId: `e2e-${nanoid(12)}`,
        scope: futurePayload.scope,
      },
    );
    expect(futureAttempt.ok()).toBeFalsy();
  });
});

test.describe("VS member score evidence", () => {
  test("remote evidence paginates, dedupes per member, and fails closed", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, cookieHeader, externalId } =
      await setupAshedAlliance(request, "officer");
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = await fetchWeek(request, cookieHeader, pastWeek);

    const memberA = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Pager A",
    });
    const memberB = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Pager B",
    });
    const scoreDate = week.days[0]!.scoreDate;

    mockState.scoreRows = [
      ...Array.from({ length: 201 }, (_, index) => ({
        id: `vs-a-${String(index).padStart(4, "0")}`,
        alliance_id: externalId,
        member_id: memberA.ashedMemberId,
        recorded_date: scoreDate,
        score: index === 200 ? 60 : 55,
        is_weekly: false,
      })),
      {
        id: "vs-b-0000",
        alliance_id: externalId,
        member_id: memberB.ashedMemberId,
        recorded_date: scoreDate,
        score: 40,
        is_weekly: false,
      },
      {
        id: "vs-foreign",
        alliance_id: "ashed-other-alliance",
        member_id: memberA.ashedMemberId,
        recorded_date: scoreDate,
        score: 999,
        is_weekly: false,
      },
      {
        id: "vs-wrong-date",
        alliance_id: externalId,
        member_id: memberA.ashedMemberId,
        recorded_date: addCalendarDays(scoreDate, -1),
        score: 999,
        is_weekly: false,
      },
      {
        id: "vs-weekly-row",
        alliance_id: externalId,
        member_id: memberA.ashedMemberId,
        recorded_date: scoreDate,
        score: 999,
        is_weekly: true,
      },
    ];

    for (const [member, score] of [
      [memberA, 60],
      [memberB, 40],
    ] as const) {
      await sql`
        INSERT INTO vs_score_heads (id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version, basis, updated_at)
        VALUES (${nanoid(16)}, ${alliance.allianceId}, ${member.ashedMemberId}, 'x', ${scoreDate}, 'daily', ${score}, 'hq', 1, ${sql.json([])}, ${new Date()})
      `;
    }

    const matchupRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    const matchup = (await matchupRes.json()) as VsMatchup;
    const dayRes = await request.patch(
      `/api/vs-performance/matchup/days/${scoreDate}`,
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          matchupId: matchup.id,
          expectedVersion: 0,
          requestId: `e2e-${nanoid(12)}`,
          totals: { ourScore: "100", opponentScore: "50" },
          reportedOutcome: null,
          finality: "final",
          scope: week.scope,
        },
      },
    );
    expect(dayRes.ok(), await dayRes.text()).toBeTruthy();

    const matched = await fetchWeek(request, cookieHeader, pastWeek);
    expect(mockState.scoreGetCount).toBeGreaterThanOrEqual(2);
    const check = matched.memberScoreChecks?.[scoreDate];
    expect(check?.status).toBe("match");

    mockState.scoreGetErrorStatus = 500;
    const degraded = await fetchWeek(request, cookieHeader, pastWeek);
    const failed = degraded.memberScoreChecks?.[scoreDate];
    expect(failed?.status).toBe("unavailable");
    mockState.scoreGetErrorStatus = null;
  });
});

test.describe("VS native capture UI flow", () => {
  test("a first-ever native capture on another week saves with fresh scope and version 0", async ({
    page,
  }) => {
    const { alliance, auth } = await setupNativeAlliance();
    const sql = getE2eSql();
    await sql`UPDATE alliances SET tag = 'LFgo' WHERE id = ${alliance.allianceId}`;
    await page.context().addCookies(playwrightAuthCookies(auth));
    const today = todayLocalDate();
    const targetWeek = getWeekStartMonday(addCalendarDays(today, -7));
    const targetDate = addCalendarDays(targetWeek, 1);

    await page.goto("/en-US/vs-performance");
    await expect(
      page.getByTestId("vs-sync-status"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("vs-sync-action"),
    ).toHaveCount(0);
    await page.getByTestId("vs-capture-open").first().click();
    const dialog = page.getByTestId("vs-capture-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("vs-capture-kind").selectOption("daily_totals");
    await dialog
      .getByTestId("vs-capture-file")
      .setInputFiles(
        path.resolve(
          __dirname,
          "../src/lib/vs-performance/fixtures/vs-daily-totals-redacted.png",
        ),
      );
    await dialog.getByTestId("vs-capture-read").click();
    await expect(page.getByTestId("vs-capture-review")).toBeVisible({
      timeout: 60_000,
    });

    await dialog.getByTestId("vs-capture-week").fill(targetWeek);
    await dialog.getByTestId("vs-capture-day").selectOption("2");
    await expect(
      dialog.getByTestId("vs-capture-finalday"),
    ).not.toBeChecked();
    await dialog.getByTestId("vs-capture-ourside").selectOption("right");
    await dialog.getByTestId("vs-capture-ourside").selectOption("left");
    await expect(
      dialog.getByTestId("vs-capture-confirm-sides"),
    ).not.toBeChecked();
    await dialog.getByTestId("vs-capture-confirm-sides").check();
    await dialog.getByTestId("vs-capture-left-score").fill("100");
    await dialog.getByTestId("vs-capture-right-score").fill("50");
    await dialog.getByTestId("vs-capture-finalday").check();

    const commitRequest = page.waitForRequest(
      (req) =>
        req.method() === "POST" && req.url().includes("/commit"),
    );
    await dialog.getByTestId("vs-capture-save").click();
    const sent = await commitRequest;
    const sentBody = sent.postDataJSON() as {
      expectedMatchupVersion: number;
      expectedDayVersions: Record<string, number>;
      review: { weekStart: string };
    };
    expect(sentBody.review.weekStart).toBe(targetWeek);
    expect(sentBody.expectedMatchupVersion).toBe(0);
    expect(sentBody.expectedDayVersions).toEqual({ [targetDate]: 0 });

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`week=${targetWeek}`));
    const visiblePanels = page.locator(
      '[data-testid="vs-matchup-results"]:visible',
    );
    await expect(visiblePanels).toHaveCount(1);
    const row = visiblePanels.getByTestId(`vs-result-${targetDate}`);
    await expect(row).toContainText("100");
    await expect(row).toContainText("50");
  });
});
