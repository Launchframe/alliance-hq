import { afterAll, describe, expect, it } from "vitest";

import { nanoid } from "nanoid";
import {
  closeE2eSql,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
} from "../../../e2e/fixtures/db";
import { createNativeVsScenario } from "../../../e2e/fixtures/vs-evidence";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { addCalendarDays } from "@/lib/trains/game-time";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { loadMyVsPerformance, loadMyVsPerformanceHistory } from "./my-performance.server";

const lastClosed = lastClosedVsWeek();

async function e2eSql() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  return getE2eSql();
}

async function linkCommander(sql: ReturnType<typeof getE2eSql>, input: { allianceId: string; hqUserId: string; name: string; rank?: number | null }) {
  const now = new Date();
  const commanderId = nanoid(16);
  const roster = await createAllianceRosterMember(sql, {
    allianceId: input.allianceId,
    currentName: input.name,
    allianceRank: input.rank ?? 3,
  });
  await sql`INSERT INTO commanders (id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at)
    VALUES (${commanderId}, ${input.name}, ${input.name.toLowerCase()}, ${input.allianceId}, ${now}, ${now})`;
  await sql`INSERT INTO commander_alliance_memberships (id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at)
    VALUES (${nanoid(16)}, ${commanderId}, ${input.allianceId}, ${roster.ashedMemberId}, 'active', ${now}, ${now}, ${now})`;
  await sql`INSERT INTO hq_user_commanders (id, hq_user_id, commander_id, is_primary, linked_at, updated_at)
    VALUES (${nanoid(16)}, ${input.hqUserId}, ${commanderId}, false, ${now}, ${now})`;
  return roster;
}

async function seedEvaluation(
  sql: ReturnType<typeof getE2eSql>,
  input: {
    allianceId: string;
    memberId: string;
    memberName?: string;
    weekEnding: string;
    outcome?: string;
    settled?: { kind: "demote" | "remove"; targetRank: number | null } | null;
    excusedDays?: number;
  },
) {
  const evaluation = {
    outcome: input.outcome ?? "passed",
    modelVersion: 2,
    counts: { required: 6, met: 5, missed: 0, excused: input.excusedDays ?? 0, unknown: 1 },
    score: 5_000_000,
    threshold: 1_000_000,
    recommendation: { kind: "none", targetRank: null },
    signal: { kind: "none", targetRank: null, reached: false },
    settled: input.settled ?? null,
    correctionReview: false,
    provisional: false,
    policyVersion: 1,
    days: [],
  };
  await sql`INSERT INTO vs_compliance_evaluations (id, alliance_id, member_id, member_name, week_ending, input, evaluation, member_snapshot)
    VALUES (${nanoid()}, ${input.allianceId}, ${input.memberId}, ${input.memberName ?? "Member"}, ${input.weekEnding}, ${sql.json({})}, ${sql.json(evaluation)}, ${sql.json({ active: true, currentRank: 3, joinedAt: null })})`;
}

afterAll(async () => {
  await closeE2eSql();
});

describe.skipIf(process.env.VS_COMPLIANCE_DB_TEST !== "1")("my VS performance against the guarded e2e database", () => {
  it("serves a legacy-linked member their own week and closed-week history", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    await seedEvaluation(sql, { allianceId: fixture.allianceId, memberId: fixture.member.memberId, memberName: fixture.member.memberName, weekEnding: lastClosed });
    const result = await loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, fixture.allianceId, {});
    expect(result.member?.memberId).toBe(fixture.member.memberId);
    expect(result.commanders.map((commander) => commander.memberId)).toEqual([fixture.member.memberId]);
    expect(result.week).not.toBeNull();
    expect(result.week!.days).toHaveLength(6);
    expect(result.history.weeks.map((week) => week.weekEnding)).toEqual([lastClosed]);
    expect(result.officerHref).toBeNull();
  });

  it("lists canonical commanders (multi-commander) without a legacy link and selects by memberId", async () => {
    const sql = await e2eSql();
    const alliance = await createNativeAlliance(sql, { tag: `MV${nanoid(5)}`, name: "My VS" });
    const user = await createAuthenticatedHqSession(sql, `${nanoid(8)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: user.hqUserId, roleName: "member", source: "manual" });
    const beta = await linkCommander(sql, { allianceId: alliance.allianceId, hqUserId: user.hqUserId, name: "Beta Commander" });
    const alpha = await linkCommander(sql, { allianceId: alliance.allianceId, hqUserId: user.hqUserId, name: "Alpha Commander" });
    const result = await loadMyVsPerformance(user.sessionId, user.hqUserId, alliance.allianceId, {});
    expect(result.commanders.map((commander) => commander.name)).toEqual(["Alpha Commander", "Beta Commander"]);
    expect(result.member?.memberId).toBe(alpha.ashedMemberId);
    const selected = await loadMyVsPerformance(user.sessionId, user.hqUserId, alliance.allianceId, { memberId: beta.ashedMemberId });
    expect(selected.member?.memberId).toBe(beta.ashedMemberId);
    expect(selected.member?.name).toBe("Beta Commander");
  });

  it("gives officers the officer detail link for their own commander", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    const result = await loadMyVsPerformance(fixture.officer.sessionId, fixture.officer.hqUserId, fixture.allianceId, {});
    expect(result.officerHref).toBe(`/vs-performance/members/${encodeURIComponent(fixture.officer.memberId)}`);
  });

  it("hides the officer link when the member role lacks vs_compliance:read", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    const baseline = await loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, fixture.allianceId, {});
    expect(baseline.officerHref).toBeNull();
  });

  it("excludes canonical commanders whose alliance membership ended or is not active", async () => {
    const sql = await e2eSql();
    const alliance = await createNativeAlliance(sql, { tag: `MV${nanoid(5)}`, name: "My VS" });
    const user = await createAuthenticatedHqSession(sql, `${nanoid(8)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: user.hqUserId, roleName: "member", source: "manual" });
    const active = await linkCommander(sql, { allianceId: alliance.allianceId, hqUserId: user.hqUserId, name: "Active Commander" });
    const former = await linkCommander(sql, { allianceId: alliance.allianceId, hqUserId: user.hqUserId, name: "Former Commander" });
    await sql`UPDATE commander_alliance_memberships SET status = 'former' WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${former.ashedMemberId}`;
    const result = await loadMyVsPerformance(user.sessionId, user.hqUserId, alliance.allianceId, {});
    expect(result.commanders.map((commander) => commander.memberId)).toEqual([active.ashedMemberId]);
    await expect(loadMyVsPerformance(user.sessionId, user.hqUserId, alliance.allianceId, { memberId: former.ashedMemberId }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await sql`UPDATE commander_alliance_memberships SET status = 'active', left_at = NOW() WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${former.ashedMemberId}`;
    const afterLeft = await loadMyVsPerformance(user.sessionId, user.hqUserId, alliance.allianceId, {});
    expect(afterLeft.commanders.map((commander) => commander.memberId)).toEqual([active.ashedMemberId]);
  });

  it("returns the empty state when the user has no linked commander", async () => {
    const sql = await e2eSql();
    const alliance = await createNativeAlliance(sql, { tag: `MV${nanoid(5)}`, name: "My VS" });
    const user = await createAuthenticatedHqSession(sql, `${nanoid(8)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: user.hqUserId, roleName: "member", source: "manual" });
    const result = await loadMyVsPerformance(user.sessionId, user.hqUserId, alliance.allianceId, {});
    expect(result.commanders).toEqual([]);
    expect(result.member).toBeNull();
    expect(result.week).toBeNull();
    expect(result.history.weeks).toEqual([]);
  });

  it("404s a foreign memberId, another owner's member, an unlinked user's memberId, and a maintainer without a link", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    await expect(loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, fixture.allianceId, { memberId: fixture.officer.memberId }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    const unlinked = await createAuthenticatedHqSession(sql, `${nanoid(8)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: fixture.allianceId, hqUserId: unlinked.hqUserId, roleName: "member", source: "manual" });
    await expect(loadMyVsPerformance(unlinked.sessionId, unlinked.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    const maintainer = await createPlatformMaintainerSession(sql);
    await expect(loadMyVsPerformance(maintainer.sessionId, maintainer.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("excludes departed roster members and foreign alliances from the owned set", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    await sql`UPDATE alliance_members SET status = 'former' WHERE alliance_id = ${fixture.allianceId} AND ashed_member_id = ${fixture.member.memberId}`;
    const departed = await loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, fixture.allianceId, {});
    expect(departed.member).toBeNull();
    const foreign = await createNativeAlliance(sql, { tag: `MV${nanoid(5)}`, name: "Foreign" });
    await expect(loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, foreign.allianceId, { memberId: fixture.member.memberId }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("rechecks ownership on history pagination", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    await seedEvaluation(sql, { allianceId: fixture.allianceId, memberId: fixture.member.memberId, weekEnding: lastClosed });
    await seedEvaluation(sql, { allianceId: fixture.allianceId, memberId: fixture.member.memberId, weekEnding: addCalendarDays(lastClosed, -7) });
    const page = await loadMyVsPerformanceHistory(fixture.member.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId, beforeWeek: lastClosed });
    expect(page.memberId).toBe(fixture.member.memberId);
    expect(page.history.weeks.map((week) => week.weekEnding)).toEqual([addCalendarDays(lastClosed, -7)]);
    await sql`DELETE FROM hq_member_links WHERE alliance_id = ${fixture.allianceId} AND hq_user_id = ${fixture.member.hqUserId}`;
    await expect(loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(loadMyVsPerformanceHistory(fixture.member.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId, beforeWeek: lastClosed }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("rejects missing, malformed, and future history cursors", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    await expect(loadMyVsPerformanceHistory(fixture.member.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId }))
      .rejects.toMatchObject({ code: "invalid_week" });
    await expect(loadMyVsPerformanceHistory(fixture.member.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId, beforeWeek: "not-a-date" }))
      .rejects.toMatchObject({ code: "invalid_week" });
    await expect(loadMyVsPerformanceHistory(fixture.member.hqUserId, fixture.allianceId, { memberId: fixture.member.memberId, beforeWeek: addCalendarDays(lastClosed, 7) }))
      .rejects.toMatchObject({ code: "invalid_week" });
  });

  it("pages twelve weeks plus one and marks corrected weeks from manual receipts only", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    for (let i = 0; i < 14; i++) {
      await seedEvaluation(sql, {
        allianceId: fixture.allianceId,
        memberId: fixture.member.memberId,
        memberName: fixture.member.memberName,
        weekEnding: addCalendarDays(lastClosed, -7 * i),
        settled: i === 0 ? { kind: "demote", targetRank: 2 } : i === 1 ? { kind: "remove", targetRank: null } : null,
        outcome: i === 2 ? "excused" : "passed",
      });
    }
    await sql`INSERT INTO vs_score_manual_edits (id, alliance_id, actor_id, member_id, week_ending, request_id, request_digest)
      VALUES (${nanoid()}, ${fixture.allianceId}, ${fixture.officer.hqUserId}, ${fixture.member.memberId}, ${lastClosed}, ${nanoid()}, 'digest')`;
    const first = await loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, fixture.allianceId, {});
    expect(first.history.weeks).toHaveLength(12);
    expect(first.history.nextBefore).toBe(addCalendarDays(lastClosed, -7 * 11));
    expect(first.history.weeks[0]!.corrected).toBe(true);
    expect(first.history.weeks[1]!.corrected).toBe(false);
    expect(first.history.weeks[0]!.settled).toEqual({ kind: "demote", targetRank: 2 });
    expect(first.history.weeks[1]!.settled).toEqual({ kind: "remove", targetRank: null });
    expect(first.history.weeks[2]!.excused).toBe(true);
    const second = await loadMyVsPerformanceHistory(fixture.member.hqUserId, fixture.allianceId, {
      memberId: fixture.member.memberId,
      beforeWeek: first.history.nextBefore!,
    });
    expect(second.history.weeks).toHaveLength(2);
    expect(second.history.nextBefore).toBeNull();
  });

  it("returns only owned weeks and a DTO free of internal action/edit/basis fields", async () => {
    const sql = await e2eSql();
    const fixture = await createNativeVsScenario(sql);
    await seedEvaluation(sql, { allianceId: fixture.allianceId, memberId: fixture.member.memberId, memberName: fixture.member.memberName, weekEnding: lastClosed });
    await seedEvaluation(sql, { allianceId: fixture.allianceId, memberId: fixture.officer.memberId, memberName: fixture.officer.memberName, weekEnding: lastClosed });
    const result = await loadMyVsPerformance(fixture.member.sessionId, fixture.member.hqUserId, fixture.allianceId, {});
    const body = JSON.stringify(result);
    expect(body).not.toContain(fixture.officer.memberName);
    expect(body).not.toContain(fixture.officer.memberId);
    expect(body).not.toContain(fixture.allianceId);
    for (const key of ["eventId", "action", "edit", "confirmationBasis", "evaluationBasis", "requestId", "requestDigest", "actorId", "actorName", "reason", "syncStatus", "episode", "inputVersion"]) {
      expect(body).not.toContain(`"${key}"`);
    }
    expect(result.history.weeks.every((week) => "syncStatus" in week === false)).toBe(true);
  });
});
