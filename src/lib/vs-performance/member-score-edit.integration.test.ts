import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ resolve: vi.fn(), validate: vi.fn(), excused: vi.fn(), fetchScope: vi.fn() }));
vi.mock("@/lib/vs-scores/ashed-transport.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vs-scores/ashed-transport.server")>();
  return {
    ...actual,
    resolveVsAshedConnection: transport.resolve,
    validateVsAshedMember: transport.validate,
  };
});
vi.mock("@/lib/time-off/excused-transport.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/time-off/excused-transport.server")>();
  return {
    ...actual,
    resolveExcusedConnection: transport.excused,
    fetchExcusedSnapshot: vi.fn(async () => []),
  };
});
vi.mock("@/lib/vs-scores/sync.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vs-scores/sync.server")>();
  return {
    ...actual,
    fetchRemoteVsScope: transport.fetchScope,
  };
});

import { nanoid } from "nanoid";
import {
  getE2eSql,
  closeE2eSql,
  createAshedAlliance,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
} from "../../../e2e/fixtures/db";
import { createNativeVsScenario, seedVsReviewJob } from "../../../e2e/fixtures/vs-evidence";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { addCalendarDays } from "@/lib/trains/game-time";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { evaluateComplianceAlliance } from "@/lib/vs-compliance/service.server";
import { changeVsBatches, commitReviewedVsScores, listVsHeads } from "@/lib/vs-scores/repository.server";
import { syncVsScoresForAlliance } from "@/lib/vs-scores/sync.server";
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
  const seed = async (date: string, score: number, period: "daily" | "weekly" = "daily", member: { memberId: string; memberName: string } = target) => {
    const job = await seedVsReviewJob(sql, { allianceId: fixture.allianceId, actor: fixture.officer, recordedDate: date, rows: [{ memberId: member.memberId, memberName: member.memberName, score }] });
    const result = await commitReviewedVsScores({ ...job, allianceId: fixture.allianceId, hqUserId: fixture.officer.hqUserId, recordedDate: date, period, requestId: randomUUID(), expectedRevision: 0 });
    return { result, job };
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

  it("recomputes only the corrected member's derived Saturday", async () => {
    const fixture = await setup();
    const other = fixture.otherOfficer;
    for (const day of days.slice(0, 5)) {
      await fixture.seed(day, 100);
      await fixture.seed(day, 200, "daily", other);
    }
    await fixture.seed(weekEnding, 700, "weekly");
    await fixture.seed(weekEnding, 1400, "weekly", other);
    const saturday = days[5];
    const saturdayHead = async (memberId: string) =>
      (await listVsHeads(fixture.allianceId, { recordedDate: saturday })).find((head) => head.memberId === memberId);
    expect((await saturdayHead(fixture.target.memberId))?.score).toBe(200);
    const otherBefore = await saturdayHead(other.memberId);
    expect(otherBefore?.score).toBe(400);

    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "0" }]);
    await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);
    expect((await saturdayHead(fixture.target.memberId))?.score).toBe(300);
    const otherAfter = await saturdayHead(other.memberId);
    expect(otherAfter?.score).toBe(400);
    expect(otherAfter?.version).toBe(otherBefore?.version);
  });

  it("applies seven changed cells as one receipt with seven manual batches", async () => {
    const fixture = await setup();
    const edit = await editFor(fixture, fixture.target.memberId);
    const cmd = {
      weekStart,
      scope: edit.scope,
      inputVersion: edit.inputVersion,
      evidenceFingerprint: edit.evidenceFingerprint,
      requestId: randomUUID().replace(/-/g, ""),
      changes: edit.cells.map((cell, index) => ({
        recordedDate: cell.recordedDate,
        period: cell.period,
        expectedHeadVersion: cell.expectedHeadVersion,
        operation: "set" as const,
        score: String(index + 1),
      })),
    };
    const result = await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);
    expect(result).toMatchObject({ ok: true, changed: 7 });
    const batches = await fixture.sql`SELECT batch_id FROM vs_score_manual_edit_batches mb INNER JOIN vs_score_manual_edits me ON me.id = mb.edit_id WHERE me.alliance_id = ${fixture.allianceId}`;
    expect(batches).toHaveLength(7);
    for (const [index, cell] of edit.cells.entries()) {
      const head = (await listVsHeads(fixture.allianceId, { recordedDate: cell.recordedDate })).find(
        (row) => row.memberId === fixture.target.memberId && row.period === cell.period,
      );
      expect(head?.score).toBe(index + 1);
    }
  });

  it("keeps a manual correction when the original upload is replayed or deleted", async () => {
    const fixture = await setup();
    const seeded = await fixture.seed(days[0], 111);
    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "777" }], { reason: "Officer fix" });
    await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);

    const [batch] = await fixture.sql`SELECT id, context_json FROM data_upload_batches WHERE parse_session_id = ${seeded.job.parseSessionId}`;
    await changeVsBatches({
      allianceId: fixture.allianceId,
      hqUserId: fixture.officer.hqUserId,
      batchIds: [batch.id],
      expectedVersions: { [batch.id]: batch.context_json.vsRevision },
      canManageAny: true,
    });
    const heads = await listVsHeads(fixture.allianceId, { recordedDate: days[0] });
    expect(heads.find((head) => head.memberId === fixture.target.memberId)?.score).toBe(777);
    const revisions = await loadVsMemberScoreRevisions(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, { weekStart });
    const manual = revisions.revisions.filter((revision) => revision.manual);
    expect(manual.length).toBeGreaterThanOrEqual(1);
    expect(manual.every((revision) => revision.reason === "Officer fix")).toBe(true);
  });

  it("corrects a former member with a recorded evaluation", async () => {
    const fixture = await setup();
    await fixture.seed(days[0], 555);
    await evaluateComplianceAlliance(fixture.allianceId, [weekEnding]);
    await fixture.sql`UPDATE alliance_members SET status = 'former' WHERE alliance_id = ${fixture.allianceId} AND ashed_member_id = ${fixture.target.memberId}`;
    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "321" }]);
    const result = await saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd);
    expect(result).toMatchObject({ ok: true, changed: 1 });
    const heads = await listVsHeads(fixture.allianceId, { recordedDate: days[0] });
    expect(heads.find((head) => head.memberId === fixture.target.memberId)?.score).toBe(321);
  });

  it("saves HQ scores for an Ashed alliance as pending with scoped sync only", async () => {
    const url = getDatabaseUrl();
    assertE2eDatabaseUrl(url);
    const sql = getE2eSql();
    const alliance = await createAshedAlliance(sql, { tag: `VSA${nanoid(4)}`, name: "Ashed VS Test" });
    await sql`UPDATE alliances SET ashed_alliance_id = ${`ashed-e2e-${nanoid(6)}`} WHERE id = ${alliance.allianceId}`;
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName: "officer", source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    const member = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: `Ashed member ${nanoid(4)}`, allianceRank: 3 });
    await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, ashedMemberId: member.ashedMemberId });
    await sql`INSERT INTO vs_compliance_policies(id, alliance_id, version, effective_week, enabled, daily_target, leeway_pct, allowed_missed_days, model_version, preset, demotion_unit, demotion_length, promotion_unit, promotion_length)
      VALUES (${`pol-${alliance.allianceId}`}, ${alliance.allianceId}, 1, ${weekEnding}, true, ${DAILY_MIN}, 0, 1, 2, 'rank_aware', 'weeks', 1, 'weeks', 2)`;
    transport.excused.mockResolvedValue(null);
    transport.resolve.mockRejectedValue(new Error("ashed offline"));

    const detail = await loadVsMemberDetail(session.sessionId, alliance.allianceId, member.ashedMemberId, { weekStart });
    const cell = detail.edit!.cells[0]!;
    const result = await saveManualVsScores(session.sessionId, alliance.allianceId, member.ashedMemberId, {
      weekStart, scope: detail.edit!.scope, inputVersion: detail.edit!.inputVersion,
      evidenceFingerprint: detail.edit!.evidenceFingerprint, requestId: randomUUID().replace(/-/g, ""),
      changes: [{ recordedDate: cell.recordedDate, period: cell.period, expectedHeadVersion: cell.expectedHeadVersion, operation: "set", score: "88" }],
    });
    expect(result).toMatchObject({ ok: true, changed: 1, syncStatus: "pending" });
    expect(transport.resolve).not.toHaveBeenCalled();
    expect(transport.fetchScope).not.toHaveBeenCalled();
    const scopes = await sql`SELECT recorded_date, period, status FROM vs_score_sync_scopes WHERE alliance_id = ${alliance.allianceId}`;
    expect(scopes).toEqual([{ recorded_date: cell.recordedDate, period: "daily", status: "pending" }]);

    await syncVsScoresForAlliance(alliance.allianceId);
    const [scope] = await sql`SELECT status FROM vs_score_sync_scopes WHERE alliance_id = ${alliance.allianceId}`;
    expect(scope.status).toBe("credentials_required");
    const heads = await listVsHeads(alliance.allianceId, { recordedDate: cell.recordedDate });
    expect(heads.find((head) => head.memberId === member.ashedMemberId)?.score).toBe(88);
  });

  it("rejects after preflight role revocation without writing a receipt", async () => {
    const fixture = await setup();
    const cmd = await command(fixture, fixture.target.memberId, [{ index: 0, operation: "set", score: "5" }]);
    await fixture.sql`UPDATE alliance_memberships SET role_id = ${ROLE_IDS.member} WHERE alliance_id = ${fixture.allianceId} AND hq_user_id = ${fixture.officer.hqUserId}`;
    await expect(saveManualVsScores(fixture.officer.sessionId, fixture.allianceId, fixture.target.memberId, cmd))
      .rejects.toMatchObject({ status: 403 });
    const edits = await fixture.sql`SELECT id FROM vs_score_manual_edits WHERE alliance_id = ${fixture.allianceId}`;
    expect(edits).toHaveLength(0);
  });
});
