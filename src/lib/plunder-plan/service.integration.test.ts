import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getSqlClient } from "@/lib/db";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, closeE2eSql } from "../../../e2e/fixtures/db";
import { loadPlunderPlan, mutatePlunderPlan } from "./service.server";
import type { PlanActor } from "./types.shared";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";

async function fixture(roleName: "member" | "officer" = "member") {
  const sql = getE2eSql();
  const { allianceId } = await createNativeAlliance(sql, { tag: `PP${randomUUID().slice(0, 6)}`, name: "Plunder Plan" });
  const session = await createAuthenticatedHqSession(sql, `${randomUUID()}@e2e.test`);
  await createAllianceMembership(sql, { allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
  const { ashedMemberId } = await createAllianceRosterMember(sql, { allianceId, currentName: "Commander", allianceRank: roleName === "officer" ? 4 : 3 });
  const link = await createHqMemberLink(sql, { allianceId, hqUserId: session.hqUserId, ashedMemberId });
  await sql`UPDATE sessions SET alliance_id = ${allianceId}, current_alliance_id = ${allianceId} WHERE id = ${session.sessionId}`;
  await sql`INSERT INTO member_alliance_tenure (id, game_uid, alliance_id, ashed_member_id, joined_at) VALUES (${randomUUID()}, ${link.gameUid}, ${allianceId}, ${ashedMemberId}, now() - interval '1 day')`;
  const actor: PlanActor = { kind: "web", allianceId, hqUserId: session.hqUserId, sessionId: session.sessionId };
  const date = addCalendarDays(getServerCalendarDate(), 1);
  const schedule = { kind: "weekly", date, zone: "Etc/GMT+2", start: "20:00", end: "21:00", days: [new Date(`${date}T12:00:00Z`).getUTCDay()], endsNextDay: false };
  const create = { action: "create", kind: "plan", memberId: ashedMemberId, requestId: randomUUID(), reminder: false, schedule };
  const load = () => loadPlunderPlan(actor, `${date}T00:00:00Z`, `${addCalendarDays(date, 8)}T00:00:00Z`);
  return { sql, allianceId, actor, memberId: ashedMemberId, schedule, create, load, date, session };
}

describe.skipIf(process.env.PLUNDER_PLAN_DB_TEST !== "1")("Plunder Plan database boundaries", () => {
  afterAll(async () => { await closeE2eSql(); await getSqlClient().end({ timeout: 5 }); });

  it("creates once across retries and rejects duplicate schedules despite JSONB key order", async () => {
    const f = await fixture();
    const first = await mutatePlunderPlan(f.actor, f.create);
    expect(await mutatePlunderPlan(f.actor, f.create)).toEqual(first);
    await expect(mutatePlunderPlan(f.actor, { ...f.create, requestId: randomUUID() })).rejects.toMatchObject({ code: "duplicate" });
    expect((await f.load()).plans).toHaveLength(1);
  });
  it("keeps exceptions across pause/resume and rejects stale concurrent changes", async () => {
    const f = await fixture(); const { id } = await mutatePlunderPlan(f.actor, f.create);
    await mutatePlunderPlan(f.actor, { action: "skip", id, date: f.date, expectedVersion: 1, requestId: randomUUID() });
    await expect(mutatePlunderPlan(f.actor, { action: "pause", id, expectedVersion: 1, requestId: randomUUID() })).rejects.toMatchObject({ code: "stale" });
    await mutatePlunderPlan(f.actor, { action: "pause", id, expectedVersion: 2, requestId: randomUUID() });
    await mutatePlunderPlan(f.actor, { action: "resume", id, expectedVersion: 3, requestId: randomUUID() });
    expect((await f.load()).suppressed).toContainEqual({ planId: id, date: f.date, reason: "skippedLabel" });
  });
  it("denies forged ownership and cross-alliance writes", async () => {
    const f = await fixture(); const other = await fixture();
    await expect(mutatePlunderPlan(f.actor, { ...f.create, memberId: other.memberId })).rejects.toMatchObject({ code: "linkRequired" });
    const { id } = await mutatePlunderPlan(other.actor, other.create);
    await expect(mutatePlunderPlan(f.actor, { action: "remove", id, expectedVersion: 1, requestId: randomUUID() })).rejects.toMatchObject({ code: "notFound" });
    await expect(loadPlunderPlan({ ...f.actor, allianceId: other.allianceId }, `${f.date}T00:00:00Z`, `${addCalendarDays(f.date, 2)}T00:00:00Z`)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("suppresses current absence without leaking its private reason", async () => {
    const f = await fixture(); await mutatePlunderPlan(f.actor, f.create);
    await f.sql`INSERT INTO member_time_off (id, alliance_id, ashed_member_id, member_name, start_date, end_date, source, notes, global_absence) VALUES (${randomUUID()}, ${f.allianceId}, ${f.memberId}, 'Commander', ${f.date}, ${f.date}, 'web', 'PRIVATE_REASON', true)`;
    const data = await f.load();
    expect(data.suppressed.some((item) => item.reason === "awayWeekly")).toBe(true);
    expect(data.occurrences.every((item) => item.localDate !== f.date)).toBe(true);
    expect(JSON.stringify(data)).not.toContain("PRIVATE_REASON");
  });
  it("does not resurrect plans after leaving and rejoining", async () => {
    const f = await fixture(); await mutatePlunderPlan(f.actor, f.create);
    await f.sql`UPDATE member_alliance_tenure SET left_at = now() WHERE alliance_id = ${f.allianceId}`;
    expect((await f.load()).occurrences).toEqual([]);
    const [old] = await f.sql`SELECT game_uid FROM member_alliance_tenure WHERE alliance_id = ${f.allianceId}`;
    await f.sql`INSERT INTO member_alliance_tenure (id, game_uid, alliance_id, ashed_member_id) VALUES (${randomUUID()}, ${old.game_uid}, ${f.allianceId}, ${f.memberId})`;
    expect((await f.load()).occurrences).toEqual([]);
  });
  it("gates suggestions and preserves member copies after a suggestion changes", async () => {
    const f = await fixture();
    await expect(mutatePlunderPlan(f.actor, { ...f.create, kind: "suggestion" })).rejects.toMatchObject({ code: "forbidden" });
    const officer = await fixture("officer");
    const source = await mutatePlunderPlan(officer.actor, { ...officer.create, kind: "suggestion", memberId: undefined });
    await mutatePlunderPlan(officer.actor, { ...officer.create, requestId: randomUUID(), sourceId: source.id });
    await mutatePlunderPlan(officer.actor, { action: "edit", id: source.id, expectedVersion: 1, requestId: randomUUID(), schedule: { ...officer.schedule, start: "18:00" }, reminder: false });
    expect((await officer.load()).plans.find((row) => row.kind === "plan")?.schedule.start).toBe("20:00");
  });
  it("updates colors without changing recurrence identity or plan versions", async () => {
    const f = await fixture(); await mutatePlunderPlan(f.actor, f.create);
    const before = await f.load();
    await mutatePlunderPlan(f.actor, { action: "color", color: "#aabbcc", expectedVersion: 0, requestId: randomUUID() });
    const after = await f.load();
    expect(after.occurrences.map((row) => row.id)).toEqual(before.occurrences.map((row) => row.id));
    expect(after.plans[0].version).toBe(before.plans[0].version);
    expect(after.occurrences.every((row) => row.color === "#AABBCC")).toBe(true);
  });
  it("revalidates membership after the actor was created", async () => {
    const f = await fixture();
    await f.sql`UPDATE alliance_memberships SET status = 'revoked' WHERE alliance_id = ${f.allianceId}`;
    await expect(mutatePlunderPlan(f.actor, f.create)).rejects.toMatchObject({ code: "forbidden" });
  });
});
