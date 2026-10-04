import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays } from "@/lib/trains/game-time";
import { createDiscordTranslator, normalizeDiscordBotLocale } from "@/lib/discord/i18n";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { escapeTimeOffDiscordText } from "@/lib/time-off/discord-workflow.shared";
import { planClock, resolvePlanClock } from "./schedule.shared";
import { lockPlans, readPlanDashboard } from "./service.server";
import { isDiscordId, sendPlanMessage } from "./transport.server";
import type { PlanTx } from "./access.server";

type Delivery = typeof schema.plunderPlanDeliveries.$inferSelect;
type Candidate = { kind: "reminder" | "digest"; recipientId: string; occurrenceKey: string; dueAt: Date; expiresAt: Date; content: string; target: { discordUserId: string } | { guildId: string; channelId: string } };
const MINUTE = 60_000;
const publicIdentity = { principalId: "delivery", aliases: [], memberIds: [], canSuggest: false, canManageSelf: false };
const discordTime = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:t>`;

async function candidates(tx: PlanTx, allianceId: string, now: Date): Promise<Candidate[]> {
  const day = planClock(now, "Etc/GMT+2").date;
  const from = resolvePlanClock(day, "00:00", "Etc/GMT+2")!;
  const until = resolvePlanClock(addCalendarDays(day, 2), "00:00", "Etc/GMT+2")!;
  const data = await readPlanDashboard(tx, allianceId, publicIdentity, from, until);
  const events = data.occurrences.filter((event) => event.kind === "plan");
  const plans = await tx.select().from(schema.plunderPlans).where(and(eq(schema.plunderPlans.allianceId, allianceId), eq(schema.plunderPlans.active, true), eq(schema.plunderPlans.removed, false), eq(schema.plunderPlans.reminder, true)));
  const ownerIds = plans.filter((plan) => plan.ownerId.startsWith("hq:")).map((plan) => plan.ownerId.slice(3));
  const links = ownerIds.length ? await tx.select().from(schema.discordHqLinks).where(inArray(schema.discordHqLinks.hqUserId, ownerIds)) : [];
  const recipients = [...new Set(plans.map((plan) => plan.ownerId.startsWith("discord:") ? plan.ownerId.slice(8) : links.find((link) => `hq:${link.hqUserId}` === plan.ownerId)?.discordUserId).filter(isDiscordId))];
  const preferences = recipients.length ? await tx.select().from(schema.discordUserPrefs).where(inArray(schema.discordUserPrefs.discordUserId, recipients)) : [];
  const result: Candidate[] = [];
  const guilds = await tx.select({ id: schema.discordGuildAlliances.guildId }).from(schema.discordGuildAlliances).where(eq(schema.discordGuildAlliances.allianceId, allianceId));
  for (const event of guilds.length ? events : []) {
    const plan = plans.find((plan) => plan.id === event.planId);
    if (!plan) continue;
    const recipientId = plan.ownerId.startsWith("discord:") ? plan.ownerId.slice(8) : links.find((link) => `hq:${link.hqUserId}` === plan.ownerId)?.discordUserId;
    if (!isDiscordId(recipientId)) continue;
    const start = Date.parse(event.startAt);
    if (start <= now.getTime() || start - 15 * MINUTE > now.getTime()) continue;
    const locale = normalizeDiscordBotLocale(preferences.find((pref) => pref.discordUserId === recipientId)?.locale);
    const t = createDiscordTranslator(locale);
    if (result.some((row) => row.kind === "reminder" && row.recipientId === recipientId && row.occurrenceKey === event.startAt)) continue;
    result.push({ kind: "reminder", recipientId, occurrenceKey: event.startAt, dueAt: new Date(start - 15 * MINUTE), expiresAt: new Date(start), target: { discordUserId: recipientId }, content: `${t("plunderPlan.notifications.reminder", { time: discordTime(event.startAt) })}\n${buildDiscordBotAppUrl(locale, "/plunder-plan")}` });
  }
  const settings = await tx.select({ setting: schema.plunderPlanDigestSettings }).from(schema.plunderPlanDigestSettings).innerJoin(schema.discordGuildAlliances, and(eq(schema.discordGuildAlliances.guildId, schema.plunderPlanDigestSettings.guildId), eq(schema.discordGuildAlliances.allianceId, schema.plunderPlanDigestSettings.allianceId)))
    .where(and(eq(schema.plunderPlanDigestSettings.allianceId, allianceId), eq(schema.plunderPlanDigestSettings.enabled, true)));
  const nextDay = resolvePlanClock(addCalendarDays(day, 1), "00:00", "Etc/GMT+2")!;
  const today = events.filter((event) => event.startAt < nextDay && event.endAt > from).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  for (const { setting } of settings) {
    const dueAt = new Date(resolvePlanClock(day, setting.timeSt, "Etc/GMT+2")!);
    if (dueAt > now || !today.length) continue;
    const locale = normalizeDiscordBotLocale(setting.locale), t = createDiscordTranslator(locale);
    let content = t("plunderPlan.notifications.digestTitle"), included = 0;
    for (const event of today) {
      const line = t("plunderPlan.notifications.digestEntry", { name: escapeTimeOffDiscordText(event.memberName.slice(0, 80)), start: discordTime(event.startAt), end: discordTime(event.endAt) });
      if (content.length + line.length > 1600) break;
      content += `\n${line}`; included++;
    }
    if (included < today.length) content += `\n${t("plunderPlan.morePlans", { count: today.length - included })}`;
    content += `\n${t("plunderPlan.notifications.open")}: ${buildDiscordBotAppUrl(locale, "/plunder-plan")}`;
    result.push({ kind: "digest", recipientId: setting.guildId, occurrenceKey: day, dueAt, expiresAt: new Date(nextDay), content, target: { guildId: setting.guildId, channelId: setting.channelId } });
  }
  return result;
}

export async function materializePlunderDeliveries(allianceId: string, now = new Date()) {
  return getDb().transaction(async (tx) => {
    await lockPlans(tx, allianceId);
    const due = await candidates(tx, allianceId, now);
    for (const { kind, recipientId, occurrenceKey, dueAt, expiresAt } of due) await tx.insert(schema.plunderPlanDeliveries).values({ id: nanoid(), allianceId, kind, recipientId, occurrenceKey, dueAt, expiresAt }).onConflictDoNothing();
    await tx.update(schema.plunderPlanState).set({ nextTickAt: new Date(now.getTime() + MINUTE) }).where(eq(schema.plunderPlanState.allianceId, allianceId));
    return due.length;
  });
}

async function prepareDelivery(candidate: Delivery, leaseToken?: string, expectedTarget?: Candidate["target"]): Promise<(Candidate & { leaseToken: string }) | null> {
  return getDb().transaction(async (tx) => {
    await lockPlans(tx, candidate.allianceId);
    const [row] = await tx.select().from(schema.plunderPlanDeliveries).where(eq(schema.plunderPlanDeliveries.id, candidate.id)).for("update");
    const now = new Date();
    if (!row || row.status === "sent" || row.status === "cancelled" || row.status === "uncertain") return null;
    if (row.status === "posting") {
      if (row.leaseUntil && row.leaseUntil <= now) await tx.update(schema.plunderPlanDeliveries).set({ status: "uncertain", leaseToken: null, leaseUntil: null }).where(eq(schema.plunderPlanDeliveries.id, row.id));
      return null;
    }
    if (leaseToken ? row.leaseToken !== leaseToken || row.status !== "leased" || !row.leaseUntil || row.leaseUntil <= now : row.dueAt > now || row.status === "leased" && row.leaseUntil && row.leaseUntil > now) return null;
    const eligible = row.expiresAt > now && row.attempts < 4 ? (await candidates(tx, row.allianceId, now)).find((item) => item.kind === row.kind && item.recipientId === row.recipientId && item.occurrenceKey === row.occurrenceKey) : null;
    if (!eligible || expectedTarget && JSON.stringify(eligible.target) !== JSON.stringify(expectedTarget)) {
      await tx.update(schema.plunderPlanDeliveries).set({ status: "cancelled", leaseToken: null, leaseUntil: null }).where(eq(schema.plunderPlanDeliveries.id, row.id));
      return null;
    }
    const token = leaseToken ?? randomUUID();
    await tx.update(schema.plunderPlanDeliveries).set({ status: leaseToken ? "posting" : "leased", leaseToken: token, leaseUntil: new Date(now.getTime() + MINUTE), attempts: row.attempts + (leaseToken ? 0 : 1) }).where(eq(schema.plunderPlanDeliveries.id, row.id));
    return { ...eligible, leaseToken: token };
  });
}

export async function deliverPlunderPlans(limit = 10, allianceId?: string) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { sent: 0 };
  const rows = await getDb().select().from(schema.plunderPlanDeliveries).where(and(allianceId ? eq(schema.plunderPlanDeliveries.allianceId, allianceId) : undefined, inArray(schema.plunderPlanDeliveries.status, ["pending", "leased", "posting"]), lte(schema.plunderPlanDeliveries.dueAt, new Date())))
    .orderBy(schema.plunderPlanDeliveries.dueAt).limit(Math.min(20, Math.max(1, limit)));
  let sent = 0;
  for (const row of rows) {
    const prepared = await prepareDelivery(row);
    if (!prepared) continue;
    const result = await sendPlanMessage({ token, nonce: row.id, target: prepared.target, authorize: async () => (await prepareDelivery(row, prepared.leaseToken, prepared.target))?.content ?? null });
    await getDb().update(schema.plunderPlanDeliveries).set({ status: result.status, messageId: result.status === "sent" ? result.messageId : null, dueAt: new Date(Date.now() + 5 * MINUTE), leaseToken: null, leaseUntil: null })
      .where(and(eq(schema.plunderPlanDeliveries.id, row.id), eq(schema.plunderPlanDeliveries.leaseToken, prepared.leaseToken), inArray(schema.plunderPlanDeliveries.status, ["leased", "posting"])));
    if (result.status === "sent") sent++;
  }
  return { sent };
}

export async function runPlunderPlanTick() {
  const rows = await getDb().select().from(schema.plunderPlanState).where(lte(schema.plunderPlanState.nextTickAt, new Date())).orderBy(schema.plunderPlanState.nextTickAt).limit(20);
  let materialized = 0, failed = 0;
  const deadline = Date.now() + 30_000;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    try { materialized += await materializePlunderDeliveries(row.allianceId); }
    catch { failed++; await getDb().update(schema.plunderPlanState).set({ nextTickAt: sql`now() + interval '5 minutes'` }).where(eq(schema.plunderPlanState.allianceId, row.allianceId)); }
  }
  return { materialized, failed, ...await deliverPlunderPlans() };
}
