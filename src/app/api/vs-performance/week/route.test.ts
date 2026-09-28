import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, PATCH } from "./route";
import { POST as previewPOST } from "./preview/route";
import { PATCH as matchupPATCH } from "../matchup/route";
import { PATCH as dayResultPATCH } from "../matchup/days/[recordedDate]/route";
import { POST as conflictPOST } from "../matchup/conflicts/[observationId]/route";
import { POST as importPOST } from "../matchup/import/route";
import { PATCH as preferencesPATCH } from "../preferences/route";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import { vsScope } from "@/lib/vs-performance/vs-scope.server";

const requireApiSession = vi.fn();
const requireSessionPermission = vi.fn();
const requireTrainOfficer = vi.fn();
const loadVsPerformanceWeek = vi.fn();
const saveVsWeekPlan = vi.fn();
const previewVsWeekPlan = vi.fn();
const saveVsMatchupIdentity = vi.fn();
const saveVsMatchDayResult = vi.fn();
const resolveVsMatchConflict = vi.fn();
const saveVsStrategyPreferences = vi.fn();
const loadVsStrategyPreferences = vi.fn();
const writeAuditLog = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => requireApiSession(...args),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: (...args: unknown[]) =>
    requireSessionPermission(...args),
  requireTrainOfficer: (...args: unknown[]) => requireTrainOfficer(...args),
}));

vi.mock("@/lib/vs-performance/weekly-plan.server", () => ({
  loadVsPerformanceWeek: (...args: unknown[]) =>
    loadVsPerformanceWeek(...args),
  saveVsWeekPlan: (...args: unknown[]) => saveVsWeekPlan(...args),
  previewVsWeekPlan: (...args: unknown[]) => previewVsWeekPlan(...args),
}));

vi.mock("@/lib/vs-performance/match-results.server", () => ({
  saveVsMatchupIdentity: (...args: unknown[]) =>
    saveVsMatchupIdentity(...args),
  saveVsMatchDayResult: (...args: unknown[]) => saveVsMatchDayResult(...args),
  resolveVsMatchConflict: (...args: unknown[]) =>
    resolveVsMatchConflict(...args),
}));

vi.mock("@/lib/vs-performance/weekly-plan.repository.server", () => ({
  loadVsStrategyPreferences: (...args: unknown[]) =>
    loadVsStrategyPreferences(...args),
  saveVsStrategyPreferences: (...args: unknown[]) =>
    saveVsStrategyPreferences(...args),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));

const session = {
  id: "sess-1",
  hqUserId: "u1",
  currentAllianceId: "a1",
  allianceId: "a1",
};

function denied(status = 403) {
  return NextResponse.json({ error: "forbidden" }, { status });
}

describe("/api/vs-performance/week", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireSessionPermission.mockResolvedValue(null);
    requireTrainOfficer.mockResolvedValue(null);
    loadVsPerformanceWeek.mockResolvedValue({ weekStart: "2099-06-08" });
  });

  it("GET rejects anonymous sessions", async () => {
    requireApiSession.mockResolvedValue(denied(401));
    const res = await GET(
      new Request("http://localhost/api/vs-performance/week"),
    );
    expect(res.status).toBe(401);
    expect(loadVsPerformanceWeek).not.toHaveBeenCalled();
  });

  it("GET rejects members without scores:read", async () => {
    requireSessionPermission.mockResolvedValue(denied());
    const res = await GET(
      new Request("http://localhost/api/vs-performance/week"),
    );
    expect(res.status).toBe(403);
    expect(loadVsPerformanceWeek).not.toHaveBeenCalled();
  });

  it("GET loads the requested week", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/vs-performance/week?weekStart=2099-06-08",
      ),
    );
    expect(res.status).toBe(200);
    expect(loadVsPerformanceWeek).toHaveBeenCalledWith("sess-1", "2099-06-08");
  });

  it("PATCH rejects non-officers", async () => {
    requireTrainOfficer.mockResolvedValue(denied());
    const res = await PATCH(
      new Request("http://localhost/api/vs-performance/week", {
        method: "PATCH",
        body: JSON.stringify({ draft: {} }),
      }),
    );
    expect(res.status).toBe(403);
    expect(saveVsWeekPlan).not.toHaveBeenCalled();
  });
});

describe("/api/vs-performance/week strict envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireTrainOfficer.mockResolvedValue(null);
    saveVsWeekPlan.mockResolvedValue({ weekStart: "2099-06-08" });
  });

  const patch = (body: string) =>
    PATCH(
      new Request("http://localhost/api/vs-performance/week", {
        method: "PATCH",
        body,
      }),
    );

  it("rejects malformed JSON", async () => {
    const res = await patch("{not json");
    expect(res.status).toBe(400);
    expect(saveVsWeekPlan).not.toHaveBeenCalled();
  });

  it("rejects null and array bodies", async () => {
    expect((await patch("null")).status).toBe(400);
    expect((await patch("[]")).status).toBe(400);
    expect(saveVsWeekPlan).not.toHaveBeenCalled();
  });

  it("rejects null and fractional expectedVersion", async () => {
    for (const v of [null, 1.5, "2"]) {
      const res = await patch(
        JSON.stringify({
          draft: {},
          expectedVersion: v,
          fingerprint: "f",
          scope: "s",
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(saveVsWeekPlan).not.toHaveBeenCalled();
  });

  it("rejects extra fields such as a caller-supplied source", async () => {
    const res = await patch(
      JSON.stringify({
        draft: {},
        expectedVersion: 0,
        fingerprint: "f",
        scope: "s",
        source: "ashed_import",
      }),
    );
    expect(res.status).toBe(400);
    expect(saveVsWeekPlan).not.toHaveBeenCalled();
  });

  it("maps stale conflicts to 409 without leaking text", async () => {
    saveVsWeekPlan.mockRejectedValue(new VsPerformanceError("stale", 409));
    const res = await patch(
      JSON.stringify({
        draft: {},
        expectedVersion: 0,
        fingerprint: "f",
        scope: "s",
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale", code: "stale" });
  });

  it("returns a generic 500 without raw SQL text", async () => {
    saveVsWeekPlan.mockRejectedValue(
      new Error('relation "vs_week_plans" does not exist at character 15'),
    );
    const res = await patch(
      JSON.stringify({
        draft: {},
        expectedVersion: 0,
        fingerprint: "f",
        scope: "s",
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "save", code: "save" });
    expect(JSON.stringify(body)).not.toContain("vs_week_plans");
  });
});

describe("/api/vs-performance/week GET weekStart validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireSessionPermission.mockResolvedValue(null);
    loadVsPerformanceWeek.mockResolvedValue({ weekStart: "2099-06-08" });
  });

  it("rejects a non-Monday weekStart", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/vs-performance/week?weekStart=2099-06-09",
      ),
    );
    expect(res.status).toBe(400);
    expect(loadVsPerformanceWeek).not.toHaveBeenCalled();
  });

  it("rejects a malformed weekStart", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/vs-performance/week?weekStart=not-a-date",
      ),
    );
    expect(res.status).toBe(400);
  });

  it("defaults to the server calendar week when omitted", async () => {
    const res = await GET(
      new Request("http://localhost/api/vs-performance/week"),
    );
    expect(res.status).toBe(200);
    const called = loadVsPerformanceWeek.mock.calls[0]![1] as string;
    expect(new Date(`${called}T12:00:00Z`).getUTCDay()).toBe(1);
  });
});

describe("/api/vs-performance/week/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireTrainOfficer.mockResolvedValue(null);
    previewVsWeekPlan.mockResolvedValue({ fingerprint: "f" });
  });

  const post = (body: string) =>
    previewPOST(
      new Request("http://localhost/api/vs-performance/week/preview", {
        method: "POST",
        body,
      }),
    );

  it("rejects extra envelope fields", async () => {
    const res = await post(
      JSON.stringify({
        draft: {},
        expectedVersion: 0,
        scope: "s",
        evidence: { kind: "ashed_import" },
      }),
    );
    expect(res.status).toBe(400);
    expect(previewVsWeekPlan).not.toHaveBeenCalled();
  });

  it("passes draft, version, scope and reapplyDates to the service", async () => {
    const res = await post(
      JSON.stringify({
        draft: { weekStart: "2099-06-08" },
        expectedVersion: 3,
        scope: "s",
        reapplyDates: ["2099-06-09"],
      }),
    );
    expect(res.status).toBe(200);
    expect(previewVsWeekPlan).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "a1", sessionId: "sess-1" }),
      { weekStart: "2099-06-08" },
      3,
      "s",
      ["2099-06-09"],
    );
  });

  it("maps stale previews to 409", async () => {
    previewVsWeekPlan.mockRejectedValue(new VsPerformanceError("stale", 409));
    const res = await post(
      JSON.stringify({ draft: {}, expectedVersion: 0, scope: "s" }),
    );
    expect(res.status).toBe(409);
  });
});

describe("/api/vs-performance/matchup/days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireTrainOfficer.mockResolvedValue(null);
    saveVsMatchDayResult.mockResolvedValue({ id: "d1" });
  });

  const patch = (body: unknown, date = "2099-06-08") =>
    dayResultPATCH(
      new Request(
        `http://localhost/api/vs-performance/matchup/days/${date}`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
      { params: Promise.resolve({ recordedDate: date }) },
    );

  it("always uses server-side hq_manual evidence", async () => {
    const scopeValue = vsScope(
      { sessionId: "sess-1", hqUserId: "u1", allianceId: "a1" },
      "2099-06-08",
    );
    const res = await patch({
      matchupId: "m1",
      expectedVersion: 0,
      requestId: "r1",
      totals: { ourScore: "10", opponentScore: "4" },
      reportedOutcome: "won",
      finality: "final",
      scope: scopeValue,
    });
    expect(res.status).toBe(200);
    expect(saveVsMatchDayResult).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: scopeValue,
        evidence: { kind: "hq_manual" },
      }),
    );
  });

  it("rejects a caller-supplied source/evidence field", async () => {
    const res = await patch({
      matchupId: "m1",
      expectedVersion: 0,
      requestId: "r1",
      finality: "final",
      scope: "s",
      evidence: { kind: "ashed_import" },
    });
    expect(res.status).toBe(400);
    expect(saveVsMatchDayResult).not.toHaveBeenCalled();
  });

  it("rejects invalid recordedDate params", async () => {
    const res = await patch(
      { matchupId: "m1", expectedVersion: 0, requestId: "r", finality: "final", scope: "s" },
      "06/08/2099",
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/vs-performance/matchup/conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireTrainOfficer.mockResolvedValue(null);
    resolveVsMatchConflict.mockResolvedValue({ id: "d1" });
  });

  it("passes actor and scope-bound body to the service", async () => {
    const res = await conflictPOST(
      new Request(
        "http://localhost/api/vs-performance/matchup/conflicts/obs9",
        {
          method: "POST",
          body: JSON.stringify({
            action: "keep_hq",
            nativeVersion: 2,
            scope: "s",
          }),
        },
      ),
      { params: Promise.resolve({ observationId: "obs9" }) },
    );
    expect(res.status).toBe(200);
    expect(resolveVsMatchConflict).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "a1" }),
      "obs9",
      expect.objectContaining({ scope: "s" }),
    );
  });

  it("maps stale conflict resolution to 409", async () => {
    resolveVsMatchConflict.mockRejectedValue(
      new VsPerformanceError("stale", 409),
    );
    const res = await conflictPOST(
      new Request(
        "http://localhost/api/vs-performance/matchup/conflicts/obs9",
        {
          method: "POST",
          body: JSON.stringify({
            action: "use_ashed",
            nativeVersion: 2,
            scope: "s",
          }),
        },
      ),
      { params: Promise.resolve({ observationId: "obs9" }) },
    );
    expect(res.status).toBe(409);
  });
});

describe("/api/vs-performance/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireTrainOfficer.mockResolvedValue(null);
    writeAuditLog.mockResolvedValue(undefined);
    saveVsStrategyPreferences.mockResolvedValue({
      version: 2,
      defaults: { mon: 1, tue: 10, wed: 10, thu: 1, fri: 10, sat: 10 },
    });
  });

  const patch = (body: unknown) =>
    preferencesPATCH(
      new Request("http://localhost/api/vs-performance/preferences", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );

  const defaults = { mon: 1, tue: 10, wed: 10, thu: 1, fri: 10, sat: 10 };
  const goodScope = () =>
    vsScope(
      { sessionId: "sess-1", hqUserId: "u1", allianceId: "a1" },
      "2099-06-08",
    );

  it("rejects a stale scope before writing", async () => {
    const res = await patch({
      weekStart: "2099-06-08",
      defaults,
      expectedVersion: 1,
      scope: "forged",
    });
    expect(res.status).toBe(409);
    expect(saveVsStrategyPreferences).not.toHaveBeenCalled();
  });

  it("saves with a fresh scope", async () => {
    const res = await patch({
      weekStart: "2099-06-08",
      defaults,
      expectedVersion: 1,
      scope: goodScope(),
    });
    expect(res.status).toBe(200);
    expect(saveVsStrategyPreferences).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ expectedVersion: 1 }),
    );
  });

  it("rejects missing weekStart", async () => {
    const res = await patch({
      defaults,
      expectedVersion: 1,
      scope: goodScope(),
    });
    expect(res.status).toBe(400);
  });
});

describe("/api/vs-performance/matchup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(session);
    requireTrainOfficer.mockResolvedValue(null);
    saveVsMatchupIdentity.mockResolvedValue({ id: "m1" });
  });

  it("binds scope to the actor tenant before writes", async () => {
    const res = await matchupPATCH(
      new Request("http://localhost/api/vs-performance/matchup", {
        method: "PATCH",
        body: JSON.stringify({
          weekStart: "2099-06-08",
          opponentName: "FOE",
          opponentTag: "F1",
          expectedVersion: 0,
          scope: "a1:2099-06-08",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(saveVsMatchupIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "a1" }),
      expect.objectContaining({
        weekStart: "2099-06-08",
        scope: "a1:2099-06-08",
      }),
    );
  });
});

describe("/api/vs-performance mutating routes deny anonymous and unprivileged sessions", () => {
  const json = { method: "PATCH", body: "{}" };
  const cases: Array<{
    name: string;
    run: () => Promise<Response>;
  }> = [
    {
      name: "PATCH /week",
      run: () =>
        PATCH(new Request("http://localhost/api/vs-performance/week", json)),
    },
    {
      name: "POST /week/preview",
      run: () =>
        previewPOST(
          new Request("http://localhost/api/vs-performance/week/preview", {
            method: "POST",
            body: "{}",
          }),
        ),
    },
    {
      name: "PATCH /matchup",
      run: () =>
        matchupPATCH(
          new Request("http://localhost/api/vs-performance/matchup", json),
        ),
    },
    {
      name: "PATCH /matchup/days",
      run: () =>
        dayResultPATCH(
          new Request(
            "http://localhost/api/vs-performance/matchup/days/2099-06-08",
            json,
          ),
          { params: Promise.resolve({ recordedDate: "2099-06-08" }) },
        ),
    },
    {
      name: "POST /matchup/conflicts",
      run: () =>
        conflictPOST(
          new Request(
            "http://localhost/api/vs-performance/matchup/conflicts/obs9",
            { method: "POST", body: "{}" },
          ),
          { params: Promise.resolve({ observationId: "obs9" }) },
        ),
    },
    {
      name: "POST /matchup/import",
      run: () => importPOST(),
    },
    {
      name: "PATCH /preferences",
      run: () =>
        preferencesPATCH(
          new Request("http://localhost/api/vs-performance/preferences", json),
        ),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(cases)("$name returns 401 without a session", async ({ run }) => {
    requireApiSession.mockResolvedValue(denied(401));
    const res = await run();
    expect(res.status).toBe(401);
    expect(saveVsWeekPlan).not.toHaveBeenCalled();
    expect(previewVsWeekPlan).not.toHaveBeenCalled();
    expect(saveVsMatchupIdentity).not.toHaveBeenCalled();
    expect(saveVsMatchDayResult).not.toHaveBeenCalled();
    expect(resolveVsMatchConflict).not.toHaveBeenCalled();
    expect(saveVsStrategyPreferences).not.toHaveBeenCalled();
  });

  it.each(cases)(
    "$name returns 403 for a bootstrap session without trains:write",
    async ({ run }) => {
      requireApiSession.mockResolvedValue({
        id: "sess-bootstrap",
        hqUserId: null,
        currentAllianceId: "a1",
        allianceId: "a1",
      });
      requireTrainOfficer.mockResolvedValue(denied(403));
      const res = await run();
      expect(res.status).toBe(403);
      expect(saveVsWeekPlan).not.toHaveBeenCalled();
      expect(previewVsWeekPlan).not.toHaveBeenCalled();
      expect(saveVsMatchupIdentity).not.toHaveBeenCalled();
      expect(saveVsMatchDayResult).not.toHaveBeenCalled();
      expect(resolveVsMatchConflict).not.toHaveBeenCalled();
      expect(saveVsStrategyPreferences).not.toHaveBeenCalled();
    },
  );
});
