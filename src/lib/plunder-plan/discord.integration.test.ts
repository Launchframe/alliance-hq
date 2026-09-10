import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeE2eSql, createAllianceRosterMember, createNativeAlliance, getE2eSql } from "../../../e2e/fixtures/db";
import { getSqlClient } from "@/lib/db";
import type { DiscordInteractionPayload } from "@/lib/discord/interactions";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { handlePlunderPlanDiscord, openPlunderPlanModal, preparePlanConfirmation, type PlanBotReply } from "./discord.server";
import { loadPlunderPlan, mutatePlunderPlan } from "./service.server";
import type { PlanActor } from "./types.shared";

const snowflake = () => `7${randomInt(1_000_000_000, 9_000_000_000)}${randomInt(1_000_000, 9_000_000)}`;
function buttons(reply: PlanBotReply) { return (reply.components as Array<{ components: Array<{ custom_id: string; label: string }> }> ?? []).flatMap((row) => row.components); }
async function fixture() {
  const sql = getE2eSql(), guildId = snowflake(), discordUserId = snowflake();
  const { allianceId } = await createNativeAlliance(sql, { tag: `PC${randomUUID().slice(0, 6)}`, name: "Plunder Plan" });
  const { ashedMemberId } = await createAllianceRosterMember(sql, { allianceId, currentName: "Friend", allianceRank: 3 });
  await sql`INSERT INTO discord_guild_alliances (guild_id, alliance_id) VALUES (${guildId}, ${allianceId})`;
  const uid = snowflake();
  await sql`INSERT INTO discord_member_links (id, alliance_id, discord_user_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${allianceId}, ${discordUserId}, ${ashedMemberId}, ${uid})`;
  await sql`INSERT INTO member_alliance_tenure (id, alliance_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${allianceId}, ${ashedMemberId}, ${uid})`;
  const actor: Extract<PlanActor, { kind: "discord" }> = { kind: "discord", allianceId, guildId, discordUserId };
  const date = addCalendarDays(getServerCalendarDate(), 1);
  const command = { action: "create", kind: "plan", memberId: ashedMemberId, requestId: randomUUID(), reminder: false, schedule: { kind: "once", date, start: "20:00", end: "21:00", zone: "Etc/GMT+2", endsNextDay: false, days: [] } };
  const payload = (type: number, data: DiscordInteractionPayload["data"]): DiscordInteractionPayload => ({ id: snowflake(), type, guild_id: guildId, member: { user: { id: discordUserId } }, locale: "en-US", data });
  const root = (name: string) => payload(2, { name: "plunder-plan", options: [{ type: 1, name }] });
  const click = (custom_id: string) => payload(3, { custom_id });
  return { sql, actor, date, command, payload, root, click };
}

describe.skipIf(process.env.PLUNDER_PLAN_DB_TEST !== "1")("Discord-only Plunder Plans", () => {
  afterAll(async () => { await closeE2eSql(); await getSqlClient().end({ timeout: 5 }); });
  it("creates through member picker, modal and confirmation without an HQ account", async () => {
    const f = await fixture();
    const members = await handlePlunderPlanDiscord(f.root("plan"));
    const cadence = await handlePlunderPlanDiscord(f.click(buttons(members)[0].custom_id));
    const modal = await openPlunderPlanModal(f.click(buttons(cadence).find((button) => button.label === "One time")!.custom_id));
    expect(modal.type).toBe(9);
    const modalData = modal.data as { custom_id: string };
    const values = { date: f.date, start: "20:00", end: "21:00", zone: "Etc/GMT+2" };
    const preview = await handlePlunderPlanDiscord(f.payload(5, { custom_id: modalData.custom_id, components: Object.entries(values).map(([custom_id, value]) => ({ components: [{ custom_id, value }] })) }));
    expect(preview.content).toContain("visible to your alliance");
    const confirm = buttons(preview).find((button) => button.label === "Confirm")!.custom_id;
    expect((await handlePlunderPlanDiscord(f.click(confirm))).content).toContain("Happy hunting!");
    expect((await handlePlunderPlanDiscord(f.click(confirm))).content).toContain("Happy hunting!");
    const rows = await f.sql`SELECT id FROM plunder_plans WHERE alliance_id = ${f.actor.allianceId}`;
    expect(rows).toHaveLength(1);
  });
  it("rejects cross-user tokens and changed confirmation payloads", async () => {
    const f = await fixture(); const { token } = await preparePlanConfirmation(f.actor, f.command);
    const forged = f.click(`plunder:${token}:confirm`); forged.member = { user: { id: snowflake() } };
    expect((await handlePlunderPlanDiscord(forged)).content).not.toContain("Happy hunting!");
    await expect(mutatePlunderPlan(f.actor, { ...f.command, reminder: true }, token)).rejects.toMatchObject({ code: "expired" });
    expect(await f.sql`SELECT id FROM plunder_plans WHERE alliance_id = ${f.actor.allianceId}`).toHaveLength(0);
  });
  it("keeps list selection bound to identity when another plan disappears", async () => {
    const f = await fixture(); await mutatePlunderPlan(f.actor, f.command);
    await mutatePlunderPlan(f.actor, { ...f.command, requestId: randomUUID(), schedule: { ...f.command.schedule, start: "21:00", end: "22:00" } });
    const listed = await handlePlunderPlanDiscord(f.root("edit"));
    const picks = buttons(listed), token = picks[0].custom_id.split(":")[1];
    const [stored] = await f.sql`SELECT state FROM plunder_plan_interactions WHERE id = ${token}`;
    const choices = stored.state.choices as Array<{ id: string; version: number }>;
    await mutatePlunderPlan(f.actor, { action: "remove", id: choices[0].id, expectedVersion: 1, requestId: randomUUID() });
    const selected = await handlePlunderPlanDiscord(f.click(picks[1].custom_id));
    const selectedToken = buttons(selected)[0].custom_id.split(":")[1];
    const [editor] = await f.sql`SELECT state FROM plunder_plan_interactions WHERE id = ${selectedToken}`;
    expect(editor.state.planId).toBe(choices[1].id);
  });
  it("honors Portuguese and denies officer suggestion controls to ordinary members", async () => {
    const f = await fixture();
    const payload = f.root("color"); payload.locale = "pt-BR";
    expect((await handlePlunderPlanDiscord(payload)).content).toBe("Escolha uma cor ou informe uma cor hexadecimal personalizada.");
    expect((await handlePlunderPlanDiscord(f.root("suggestions"))).content).toBe("You don’t have access to this Plunder Plan action.");
    const data = await loadPlunderPlan(f.actor, `${f.date}T00:00:00Z`, `${addCalendarDays(f.date, 1)}T00:00:00Z`);
    expect(data.canSuggest).toBe(false);
  });
});
