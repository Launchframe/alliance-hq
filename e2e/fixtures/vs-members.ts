import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";

import { addCalendarDays } from "../../src/lib/trains/game-time";
import { lastClosedVsWeek } from "../../src/lib/vs-compliance/workflow.shared";
import {
  authCookieHeader,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  type SessionFixture,
} from "./db";

export type VsMembersActor = SessionFixture & { headers: { Cookie: string } };

const DAILY_MIN = 1_000_000;

export async function setupVsMembersFixture() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `VM${nanoid(5)}`,
    name: "VS Members Table",
  });
  const actor = async (roleName: string): Promise<VsMembersActor> => {
    const session = await createAuthenticatedHqSession(
      sql,
      `vsm-${roleName}-${randomBytes(4).toString("hex")}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName,
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
    });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag} WHERE id = ${session.sessionId}`;
    return { ...session, headers: { Cookie: authCookieHeader(session) } };
  };

  const weekEnding = lastClosedVsWeek();
  const weekStart = addCalendarDays(weekEnding, -6);
  const days = Array.from({ length: 6 }, (_, i) => addCalendarDays(weekEnding, i - 6));

  await sql`INSERT INTO vs_compliance_policies(id, alliance_id, version, effective_week, enabled, daily_target, leeway_pct, allowed_missed_days, model_version, preset, demotion_unit, demotion_length, promotion_unit, promotion_length)
    VALUES (${nanoid()}, ${alliance.allianceId}, 1, ${weekEnding}, true, ${DAILY_MIN}, 0, 1, 2, 'rank_aware', 'weeks', 1, 'weeks', 2)`;

  const member = async (name: string) => {
    const row = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: name,
      allianceRank: 3,
    });
    await sql`UPDATE alliance_members SET join_date = '2020-01-01' WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${row.ashedMemberId}`;
    return row.ashedMemberId;
  };
  const score = (memberId: string, date: string, value: number) =>
    sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version)
      VALUES (${nanoid()}, ${alliance.allianceId}, ${memberId}, 'M', ${date}, 'daily', ${value}, 'hq', 1)`;

  // Meeting: all 6 days at the daily minimum.
  const meeting = await member("VSM Meeting");
  for (const day of days) await score(meeting, day, DAILY_MIN + 100);
  // Below: two days under minimum (allowed = 1).
  const below = await member("VSM Below");
  for (const [i, day] of days.entries()) await score(below, day, i < 2 ? 10 : DAILY_MIN + 100);
  // Zero: all six days at 0.
  const zero = await member("VSM Zero");
  for (const day of days) await score(zero, day, 0);
  // Needs evidence: five days met, one day with no score.
  const missing = await member("VSM Missing");
  for (const day of days.slice(0, 5)) await score(missing, day, DAILY_MIN + 100);
  // Partly excused: five days met, one excused via time off.
  const excused = await member("VSM Excused");
  for (const day of days.slice(0, 5)) await score(excused, day, DAILY_MIN + 100);
  const entryId = nanoid();
  const excusedDay = days[5];
  await sql`INSERT INTO member_time_off(id, alliance_id, ashed_member_id, member_name, start_date, end_date, global_absence, availability, entry_kind, activity_scope, source, notice_verified, sync_status)
    VALUES (${entryId}, ${alliance.allianceId}, ${excused}, 'VSM Excused', ${excusedDay}, ${excusedDay}, true, 'full_away', 'planned', 'vs', 'web', true, 'local')`;
  await sql`INSERT INTO member_time_off_revisions(id, entry_id, alliance_id, version, snapshot, recorded_at)
    VALUES (${nanoid()}, ${entryId}, ${alliance.allianceId}, 1,
      ${sql.json({ startDate: excusedDay, endDate: excusedDay, entryKind: "planned", globalAbsence: true, cancelled: false, activityScope: "vs" })},
      '2020-01-01T00:00:00Z')`;

  return { sql, alliance, weekEnding, weekStart, days, actor };
}
