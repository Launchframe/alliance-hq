import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeE2eSql, createAllianceRosterMember, createNativeAlliance, getE2eSql } from "../../../e2e/fixtures/db";
import { getSqlClient } from "@/lib/db";
import type { PlanActor } from "./types.shared";
import { planClock } from "./schedule.shared";
import { mutatePlunderPlan } from "./service.server";
import { deliverPlunderPlans, materializePlunderDeliveries } from "./delivery.server";

const transport = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn() }));
vi.mock("./transport.server", async (original) => ({ ...await original<object>(), sendPlanMessage: transport.send, verifyPlanChannel: transport.verify }));
const snowflake = () => `7${randomInt(1_000_000_000, 9_000_000_000)}${randomInt(1_000_000, 9_000_000)}`;

async function fixture() {
  const sql = getE2eSql(), guildId = snowflake(), discordUserId = snowflake();
  const { allianceId } = await createNativeAlliance(sql, { tag: `PD${randomUUID().slice(0, 6)}`, name: "Plunder Plan" });
  const { ashedMemberId } = await createAllianceRosterMember(sql, { allianceId, currentName: "Friend @everyone", allianceRank: 4 });
  await sql`INSERT INTO discord_guild_alliances (guild_id, alliance_id) VALUES (${guildId}, ${allianceId})`;
  const uid = snowflake();
  await sql`INSERT INTO discord_member_links (id, alliance_id, discord_user_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${allianceId}, ${discordUserId}, ${ashedMemberId}, ${uid})`;
  await sql`INSERT INTO member_alliance_tenure (id, alliance_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${allianceId}, ${ashedMemberId}, ${uid})`;
  const actor: PlanActor = { kind: "discord", allianceId, guildId, discordUserId };
  const start = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 10 * 60_000), end = new Date(start.getTime() + 60 * 60_000);
  const schedule = { kind: "once", date: start.toISOString().slice(0, 10), zone: "UTC", start: start.toISOString().slice(11, 16), end: end.toISOString().slice(11, 16), endsNextDay: start.getUTCDate() !== end.getUTCDate(), days: [] };
  const plan = await mutatePlunderPlan(actor, { action: "create", kind: "plan", memberId: ashedMemberId, schedule, reminder: true, requestId: randomUUID() });
  return { sql, actor, allianceId, guildId, discordUserId, memberId: ashedMemberId, plan, start, schedule };
}

describe.skipIf(process.env.PLUNDER_PLAN_DB_TEST !== "1")("Plunder Plan delivery with real DB and mocked Discord", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("DISCORD_BOT_TOKEN", "test-only");
    transport.verify.mockResolvedValue(true);
    transport.send.mockImplementation(async (input) => await input.authorize(snowflake()) ? { status: "sent", messageId: snowflake() } : { status: "cancelled" });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await closeE2eSql(); await getSqlClient().end({ timeout: 5 }); });

  it("delivers one reminder across repeated ticks and color edits", async () => {
    const f = await fixture();
    await materializePlunderDeliveries(f.allianceId);
    await materializePlunderDeliveries(f.allianceId);
    await mutatePlunderPlan(f.actor, { action: "color", color: "#112233", expectedVersion: 0, requestId: randomUUID() });
    await deliverPlunderPlans(20, f.allianceId);
    await materializePlunderDeliveries(f.allianceId);
    await deliverPlunderPlans(20, f.allianceId);
    const rows = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe("sent");
    expect(transport.send.mock.calls.filter(([input]) => input.target.discordUserId === f.discordUserId)).toHaveLength(1);
  });
  it("revalidates reminder consent immediately before sending", async () => {
    const f = await fixture(); await materializePlunderDeliveries(f.allianceId);
    transport.send.mockImplementation(async (input) => {
      if (input.target.discordUserId === f.discordUserId) await mutatePlunderPlan(f.actor, { action: "edit", id: f.plan.id, expectedVersion: 1, schedule: f.schedule, reminder: false, requestId: randomUUID() });
      return await input.authorize(snowflake()) ? { status: "sent", messageId: snowflake() } : { status: "cancelled" };
    });
    await deliverPlunderPlans(20, f.allianceId);
    const [row] = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(row.status).toBe("cancelled");
  });
  it("serializes concurrent delivery attempts", async () => {
    const f = await fixture(); await materializePlunderDeliveries(f.allianceId);
    await Promise.all([deliverPlunderPlans(20, f.allianceId), deliverPlunderPlans(20, f.allianceId)]);
    expect(transport.send.mock.calls.filter(([input]) => input.target.discordUserId === f.discordUserId)).toHaveLength(1);
  });
  it("suppresses an already-queued reminder when time off is added", async () => {
    const f = await fixture(); await materializePlunderDeliveries(f.allianceId);
    await f.sql`INSERT INTO member_time_off (id, alliance_id, ashed_member_id, member_name, start_date, end_date, source, global_absence) VALUES (${randomUUID()}, ${f.allianceId}, ${f.memberId}, 'Friend', ${planClock(f.start, "Etc/GMT+2").date}, ${planClock(f.start, "Etc/GMT+2").date}, 'web', true)`;
    await deliverPlunderPlans(20, f.allianceId);
    const [row] = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(row.status).toBe("cancelled"); expect(transport.send).not.toHaveBeenCalled();
  });
  it("expires queued reminders rather than sending late", async () => {
    const f = await fixture(); await materializePlunderDeliveries(f.allianceId);
    await f.sql`UPDATE plunder_plan_deliveries SET expires_at = now() - interval '1 second' WHERE alliance_id = ${f.allianceId}`;
    await deliverPlunderPlans(20, f.allianceId);
    const [row] = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(row.status).toBe("cancelled"); expect(transport.send).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain send", async () => {
    const f = await fixture(); await materializePlunderDeliveries(f.allianceId);
    transport.send.mockImplementation(async (input) => { await input.authorize(snowflake()); return { status: "uncertain" }; });
    await deliverPlunderPlans(20, f.allianceId); await deliverPlunderPlans(20, f.allianceId);
    const [row] = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(row.status).toBe("uncertain");
    expect(transport.send.mock.calls.filter(([input]) => input.target.discordUserId === f.discordUserId)).toHaveLength(1);
    await materializePlunderDeliveries(f.allianceId);
    const [again] = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(again.status).toBe("uncertain");
  });
  it("gates channel settings and does not deliver after a guild rebind", async () => {
    const f = await fixture();
    await mutatePlunderPlan(f.actor, { action: "notifications", guildId: f.guildId, channelId: snowflake(), timeSt: "00:00", locale: "pt-BR", enabled: true, expectedVersion: 0, requestId: randomUUID() });
    await materializePlunderDeliveries(f.allianceId);
    const { allianceId: other } = await createNativeAlliance(f.sql, { tag: `PX${randomUUID().slice(0, 6)}`, name: "Other" });
    await f.sql`UPDATE discord_guild_alliances SET alliance_id = ${other} WHERE guild_id = ${f.guildId}`;
    await deliverPlunderPlans(20, f.allianceId);
    const rows = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId} AND kind = 'digest'`;
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe("cancelled");
    await expect(mutatePlunderPlan(f.actor, { action: "notifications", guildId: f.guildId, channelId: snowflake(), timeSt: "00:00", locale: "en-US", enabled: true, expectedVersion: 1, requestId: randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
    const nextDiscord = snowflake();
    const { ashedMemberId } = await createAllianceRosterMember(f.sql, { allianceId: other, currentName: "Next Officer", allianceRank: 4 });
    const uid = snowflake();
    await f.sql`INSERT INTO discord_member_links (id, alliance_id, discord_user_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${other}, ${nextDiscord}, ${ashedMemberId}, ${uid})`;
    await f.sql`INSERT INTO member_alliance_tenure (id, alliance_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${other}, ${ashedMemberId}, ${uid})`;
    const nextActor: PlanActor = { kind: "discord", allianceId: other, guildId: f.guildId, discordUserId: nextDiscord };
    await mutatePlunderPlan(nextActor, { action: "notifications", guildId: f.guildId, channelId: snowflake(), timeSt: "09:15:00", locale: "en-US", enabled: true, expectedVersion: 1, requestId: randomUUID() });
    const [setting] = await f.sql`SELECT alliance_id, time_st FROM plunder_plan_digest_settings WHERE guild_id = ${f.guildId}`;
    expect(setting.alliance_id).toBe(other);
    expect(setting.time_st).toBe("09:15");
  });
  it("revives cancelled deliveries when the occurrence is eligible again", async () => {
    const f = await fixture();
    await materializePlunderDeliveries(f.allianceId);
    const timeOffId = randomUUID();
    await f.sql`INSERT INTO member_time_off (id, alliance_id, ashed_member_id, member_name, start_date, end_date, source, global_absence) VALUES (${timeOffId}, ${f.allianceId}, ${f.memberId}, 'Friend', ${planClock(f.start, "Etc/GMT+2").date}, ${planClock(f.start, "Etc/GMT+2").date}, 'web', true)`;
    await deliverPlunderPlans(20, f.allianceId);
    const [cancelled] = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(cancelled.status).toBe("cancelled");
    await f.sql`UPDATE member_time_off SET cancelled_at = now() WHERE id = ${timeOffId}`;
    await materializePlunderDeliveries(f.allianceId);
    const [revived] = await f.sql`SELECT status, attempts FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(revived.status).toBe("pending");
    expect(revived.attempts).toBe(0);
    await deliverPlunderPlans(20, f.allianceId);
    const [sent] = await f.sql`SELECT status FROM plunder_plan_deliveries WHERE alliance_id = ${f.allianceId}`;
    expect(sent.status).toBe("sent");
  });
});
