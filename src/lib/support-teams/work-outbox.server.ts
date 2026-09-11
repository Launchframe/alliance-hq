import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createDiscordTranslator, normalizeDiscordBotLocale } from "@/lib/discord/i18n";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { canViewTeamWork } from "./work-routing.shared";
import { reconcileTeamWork, reconcileTeamWorkTx } from "./work-service.server";
import { sendPrivateWorkDigest } from "./work-transport.server";

type Digest = typeof schema.teamWorkDigests.$inferSelect;

async function prepareDigest(candidate: Digest, leaseToken?: string, channelId?: string) {
  return getDb().transaction(async (tx) => {
    const result = await reconcileTeamWorkTx(tx, candidate.allianceId);
    const [digest] = await tx.select().from(schema.teamWorkDigests).where(and(eq(schema.teamWorkDigests.id, candidate.id), eq(schema.teamWorkDigests.allianceId, candidate.allianceId))).for("update");
    if (!digest) return null;
    const now = new Date();
    if (leaseToken) {
      if (digest.status !== "leased" || digest.leaseToken !== leaseToken || !digest.leaseUntil || digest.leaseUntil <= now) return null;
    } else {
      if (digest.status === "posting" && digest.leaseUntil && digest.leaseUntil <= now) {
        await tx.update(schema.teamWorkDigests).set({ status: "uncertain", lastError: "lease_expired_after_post", updatedAt: now }).where(eq(schema.teamWorkDigests.id, digest.id));
        return null;
      }
      if (digest.status !== "pending" && !(digest.status === "leased" && digest.leaseUntil && digest.leaseUntil <= now)) return null;
      if (digest.nextAttemptAt > now) return null;
    }
    const recipient = result.recipients.find((row) => row.id === digest.recipientId);
    if (digest.day !== getServerCalendarDate() || !recipient || !result.items.some((item) => canViewTeamWork(item, recipient, true))) {
      await tx.update(schema.teamWorkDigests).set({ status: "cancelled", leaseToken: null, leaseUntil: null, updatedAt: now }).where(eq(schema.teamWorkDigests.id, digest.id));
      return null;
    }
    const [link] = await tx.select({ discordUserId: schema.discordHqLinks.discordUserId }).from(schema.discordHqLinks).where(eq(schema.discordHqLinks.hqUserId, recipient.id)).for("share");
    if (!link || leaseToken && link.discordUserId !== digest.discordUserId) {
      await tx.update(schema.teamWorkDigests).set({ status: "pending", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + 3_600_000), lastError: "recipient_unlinked", updatedAt: now }).where(eq(schema.teamWorkDigests.id, digest.id));
      return null;
    }
    const [preference] = await tx.select({ locale: schema.discordUserPrefs.locale }).from(schema.discordUserPrefs).where(eq(schema.discordUserPrefs.discordUserId, link.discordUserId));
    const token = leaseToken ?? randomUUID();
    await tx.update(schema.teamWorkDigests).set({ status: leaseToken ? "posting" : "leased", leaseToken: token, leaseUntil: new Date(Date.now() + 60_000), discordUserId: link.discordUserId, channelId: channelId ?? null, attempts: leaseToken ? digest.attempts : digest.attempts + 1, updatedAt: now }).where(eq(schema.teamWorkDigests.id, digest.id));
    return { ...digest, discordUserId: link.discordUserId, leaseToken: token, locale: normalizeDiscordBotLocale(preference?.locale) };
  });
}

export async function deliverTeamWorkDigests(limit = 5) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { delivered: 0 };
  const candidates = await getDb().select().from(schema.teamWorkDigests).where(and(inArray(schema.teamWorkDigests.status, ["pending", "leased", "posting"]), lte(schema.teamWorkDigests.nextAttemptAt, new Date()), or(eq(schema.teamWorkDigests.status, "pending"), lte(schema.teamWorkDigests.leaseUntil, new Date())))).orderBy(schema.teamWorkDigests.nextAttemptAt).limit(limit);
  let delivered = 0;
  for (const candidate of candidates) {
    const prepared = await prepareDigest(candidate);
    if (!prepared) continue;
    const t = createDiscordTranslator(prepared.locale);
    const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "https://frontline.gay";
    const result = await sendPrivateWorkDigest({ token, discordUserId: prepared.discordUserId, content: `${t("teamWork.digest")}\n${appUrl}/${prepared.locale}/team-work`, nonce: prepared.id.slice(0, 24),
      authorizeSend: async (channelId) => !!await prepareDigest(prepared, prepared.leaseToken, channelId),
    });
    await getDb().transaction(async (tx) => {
      await tx.update(schema.teamWorkDigests).set({ status: result.status, messageId: result.status === "sent" ? result.messageId : null, leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + 3_600_000), lastError: result.status === "pending" ? "delivery_rejected" : result.status === "uncertain" ? "delivery_uncertain" : null, updatedAt: new Date() })
        .where(and(eq(schema.teamWorkDigests.id, prepared.id), eq(schema.teamWorkDigests.allianceId, prepared.allianceId), eq(schema.teamWorkDigests.leaseToken, prepared.leaseToken), inArray(schema.teamWorkDigests.status, ["leased", "posting"])));
    });
    if (result.status === "sent") delivered++;
  }
  return { delivered };
}

export async function runTeamWorkTick() {
  const alliances = await getDb().select({ id: schema.alliances.id }).from(schema.alliances).leftJoin(schema.teamWorkState, eq(schema.teamWorkState.allianceId, schema.alliances.id))
    .where(and(sql`(exists (select 1 from support_team_boards b where b.alliance_id = ${schema.alliances.id}) or exists (select 1 from member_time_off t where t.alliance_id = ${schema.alliances.id}) or exists (select 1 from vs_compliance_state c where c.alliance_id = ${schema.alliances.id}))`, or(isNull(schema.teamWorkState.nextAttemptAt), lte(schema.teamWorkState.nextAttemptAt, new Date()))))
    .orderBy(sql`${schema.teamWorkState.reconciledAt} asc nulls first`, schema.alliances.id).limit(2);
  let reconciled = 0;
  let failed = 0;
  for (const alliance of alliances) {
    try { await reconcileTeamWork(alliance.id); reconciled++; }
    catch {
      failed++;
      await getDb().transaction(async (tx) => {
        const retry = { nextAttemptAt: new Date(Date.now() + 300_000), lastError: "reconciliation_failed" };
        await tx.insert(schema.teamWorkState).values({ allianceId: alliance.id, ...retry }).onConflictDoUpdate({ target: schema.teamWorkState.allianceId, set: retry });
      });
    }
  }
  return { reconciled, failed, ...await deliverTeamWorkDigests() };
}
