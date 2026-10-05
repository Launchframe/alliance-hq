import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ resolve: vi.fn(), validate: vi.fn() }));
vi.mock("@/lib/vs-scores/ashed-transport.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vs-scores/ashed-transport.server")>();
  return {
    ...actual,
    resolveVsAshedConnection: transport.resolve,
    validateVsAshedMember: transport.validate,
  };
});

import { getE2eSql, closeE2eSql } from "../../../e2e/fixtures/db";
import { createNativeVsScenario, seedVsReviewJob } from "../../../e2e/fixtures/vs-evidence";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { addCalendarDays } from "@/lib/trains/game-time";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { commitReviewedVsScores, listVsHeads } from "@/lib/vs-scores/repository.server";
import { saveManualVsScores } from "./member-score-edit.server";
import { loadVsMemberDetail, loadVsMemberScoreRevisions } from "./member-performance.server";

const weekEnding = lastClosedVsWeek();
const weekStart = addCalendarDays(weekEnding, -6);
const days = Array.from({ length: 6 }, (_, i) => addCalendarDays(weekEnding, i - 6));
const DAILY_MIN = 1_000_000;
let usedDatabase = false;

async function setup() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (url !== (process.env.E2E_DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim())) throw new Error("test_database_mismatch");
  usedDatabase = true;
  const sql = getE2eSql();
  const fixture = await createNativeVsScenario(sql);
  await sql`INSERT INTO vs_compliance_policies(id, alliance_id, version, effective_week, enabled, daily_target, leeway_pct, allowed_missed_days, model_version, preset, demotion_unit, demotion_length, promotion_unit, promotion_length)
    VALUES (${`pol-${fixture.allianceId}`}, ${fixture.allianceId}, 1, ${weekEnding}, true, ${DAILY_MIN}, 0, 1, 2, 'rank_aware', 'weeks', 1, 'weeks', 2)`;
  const target = fixture.member;
  const seed = async (date: string, score: number, period: "daily" | "weekly" = "daily") => {
    const job = await seedVsReviewJob(sql, { allianceId: fixture.allianceId, actor: fixture.officer, recordedDate: date, rows: [{ memberId: target.memberId, memberName: target.memberName, score }] });
    return commitReviewedVsScores({ ...job, allianceId: fixture.allianceId, hqUserId: fixture.officer.hqUserId, recordedDate: date, period, requestId: randomUUID(), expectedRevision: 0 });
  };
  return { sql, ...fixture, target, seed };
}

async function editFor(fixture: Awaited<ReturnType<typeof setup>>, memberId: string) {
  const detail = await loadVsMemberDetail(fixture.officer.sessionId, fixture.allianceId, memberId, { weekStart });
  if (!detail.edit) throw new Error("edit_context_missing");
  return detail.edit;
}

async function command(fixture: Awaited<ReturnType<typeof setup>>, memberId: string, changes: Array<{ index: number; operation: "set" | "clear"; score?: string }>, over: Record<string, unknown> = {}) {
  const edit = await editFor(fixture, memberId);
  return {
    weekStart,
    scope: edit.scope,
    inputVersion: edit.inputVersion,
    evidenceFingerprint: edit.evidenceFingerprint,
    requestId: randomUUID().replace(/-/g, ""),
    changes: changes.map((change) => {
      const cell = edit.cells[change.index]!;
      return change.operation === "set"
        ? { recordedDate: cell.recordedDate, period: cell.period, expectedHeadVersion: cell.expectedHeadVersion, operation: "set" as const, score: change.score! }
        : { recordedDate: cell.recordedDate, period: cell.period, expectedHeadVersion: cell.expectedHeadVersion, operation: "clear" as const };
    }),
    ...over,
  };
}

describe.skipIf(process.env.VS_EVIDENCE_DB_TEST !== "1")("manual VS score edits with guarded real DB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterAll(async () => {
    if (usedDatabase) await closeE2eSql();
  });

  it("sets an explicit zero, clears a recorded head, and marks revisions manual with private reason", async () => {
    const fixture = await setup();
    for (const day of days.slice(0, 3)) await fixture.seed(day, DAILY_MIN + 50);
    const cmd = await command(fixture, fixture.target.memberId, [
      { index: 0, operation: "set", score: "0" },
      { index: 1, operation: "clear" },
    ], { reason: "Officer fix" });
    const result = await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);
    expect(result).toMatchObject({ ok: true, changed: 2, syncStatus: "local", replayed: false });
    const heads = await listVsHeads(fixture.allianceId, { dates: [days[0], days[1]] });
    const head0 = heads.find((head) => head.memberId === fixture.target.memberId && head.recordedDate === days[0]);
    const head1 = heads.find((head) => head.memberId === fixture.target.memberId && head.recordedDate === days[1]);
    expect(head0?.score).toBe(0);
    expect(head1?.score).toBeNull();
    const revisions = await loadVsMemberScoreRevisions(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, { weekStart });
    const manual = revisions.revisions.filter((revision) => revision.manual);
    expect(manual.length).toBeGreaterThanOrEqual(1);
    expect(manual.every((revision) => revision.reason === "Officer fix")).toBe(true);
  });

  it("replays the same request id and rejects a changed body under the same key", async () => {
    const fixture = await setup();
    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "5" }]);
    const first = await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);
    const second = await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);
    expect(first.replayed).toBe(false);
    expect(second).toEqual({ ...first, replayed: true });
    const rows = await fixture.sql`SELECT id FROM vs_score_manual_edits WHERE alliance_id = ${fixture.allianceId}`;
    expect(rows.length).toBe(1);
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, { ...cmd, changes: [{ ...cmd.changes[0]!, score: "9" }] }))
      .rejects.toMatchObject({ code: "stale", status: 409 });
  });

  it("rejects stale fingerprints, head versions, input versions and non-officers", async () => {
    const fixture = await setup();
    const base = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "5" }]);
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, { ...base, inputVersion: base.inputVersion + 99 }))
      .rejects.toMatchObject({ code: "stale", status: 409 });
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, { ...base, evidenceFingerprint: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "stale", status: 409 });
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, { ...base, changes: [{ ...base.changes[0]!, expectedHeadVersion: 77 }] }))
      .rejects.toMatchObject({ code: "stale", status: 409 });
    await expect(saveManualVsScores(fixture.member.sessionId, fixture.allianceId, fixture.target.memberId, base))
      .rejects.toMatchObject({ status: 403 });
    await expect(saveManualVsScores(fixture.dataEntry.sessionId, fixture.allianceId, fixture.target.memberId, base))
      .rejects.toMatchObject({ status: 403 });
  });

  it("rejects changes for unclosed days and malformed commands", async () => {
    const fixture = await setup();
    const liveStart = addCalendarDays(weekEnding, 1);
    const liveDetail = await loadVsMemberDetail(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, { weekStart: liveStart });
    const unclosed = liveDetail.edit?.cells.find((cell) => !cell.editable);
    expect(unclosed).toBeTruthy();
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, {
      weekStart: liveStart, scope: liveDetail.edit!.scope, inputVersion: liveDetail.edit!.inputVersion, evidenceFingerprint: liveDetail.edit!.evidenceFingerprint,
      requestId: randomUUID().replace(/-/g, ""),
      changes: [{ recordedDate: unclosed!.recordedDate, period: unclosed!.period, expectedHeadVersion: null, operation: "set", score: "5" }],
    })).rejects.toMatchObject({ code: "invalid_period", status: 400 });
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, null))
      .rejects.toMatchObject({ code: "invalid_rows", status: 400 });
    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "abc" }]);
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd))
      .rejects.toMatchObject({ code: "invalid_score", status: 400 });
  });

  it("a later bulk upload cannot overwrite a manual correction", async () => {
    const fixture = await setup();
    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "777" }]);
    await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);
    await fixture.seed(days[0], 12345);
    const heads = await listVsHeads(fixture.allianceId, { recordedDate: days[0] });
    expect(heads.find((head) => head.memberId === fixture.target.memberId)?.score).toBe(777);
  });

  it("returns 404 for members outside the alliance", async () => {
    const fixture = await setup();
    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "5" }]);
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, "foreign-member", cmd))
      .rejects.toMatchObject({ status: 404 });
  });
});
