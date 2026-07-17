import "server-only";

import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";

// ---------------------------------------------------------------------------
// Channel lookup helpers
// ---------------------------------------------------------------------------

type ChannelTarget = {
  guildId: string;
  allianceId: string;
  channelId: string;
};

export async function listGuildsWithSeasonalEventsChannel(): Promise<
  ChannelTarget[]
> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      allianceId: schema.discordGuildAlliances.allianceId,
      channelId: schema.discordGuildAlliances.seasonalEventsChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(
      sql`${schema.discordGuildAlliances.seasonalEventsChannelId} is not null`,
    );
  return rows.filter(
    (r): r is ChannelTarget => Boolean(r.channelId?.trim()),
  );
}

export async function listGuildsWithBankingChannel(): Promise<ChannelTarget[]> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      allianceId: schema.discordGuildAlliances.allianceId,
      channelId: schema.discordGuildAlliances.bankingChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(sql`${schema.discordGuildAlliances.bankingChannelId} is not null`);
  return rows.filter(
    (r): r is ChannelTarget => Boolean(r.channelId?.trim()),
  );
}

function groupByAlliance(targets: ChannelTarget[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of targets) {
    const list = map.get(t.allianceId) ?? [];
    list.push(t.channelId);
    map.set(t.allianceId, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Pre-capture countdown announcements
// ---------------------------------------------------------------------------

const PRE_CAPTURE_WINDOW_MS = 60 * 60 * 1000;

export async function processPreCaptureAnnouncements(): Promise<{
  posted: number;
  skipped: number;
}> {
  const targets = await listGuildsWithSeasonalEventsChannel();
  if (targets.length === 0) return { posted: 0, skipped: 0 };

  const channelsByAlliance = groupByAlliance(targets);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + PRE_CAPTURE_WINDOW_MS);
  const db = getDb();
  let posted = 0;
  let skipped = 0;

  for (const [allianceId, channels] of channelsByAlliance) {
    const settings = await db
      .select({ enabled: schema.battlePlanSettings.discordReportsEnabled })
      .from(schema.battlePlanSettings)
      .where(eq(schema.battlePlanSettings.allianceId, allianceId))
      .limit(1);

    if (!settings[0] || settings[0].enabled === 0) {
      skipped += channels.length;
      continue;
    }

    const events = await db
      .select()
      .from(schema.battlePlanCaptureEvents)
      .where(
        and(
          eq(schema.battlePlanCaptureEvents.allianceId, allianceId),
          eq(schema.battlePlanCaptureEvents.status, "scheduled"),
          eq(schema.battlePlanCaptureEvents.territoryType, "stronghold"),
          lte(schema.battlePlanCaptureEvents.scheduledAt, windowEnd),
          isNull(schema.battlePlanCaptureEvents.discordAnnouncedAt),
          sql`${schema.battlePlanCaptureEvents.scheduledAt} >= ${now}`,
        ),
      );

    if (events.length === 0) {
      skipped += channels.length;
      continue;
    }

    for (const event of events) {
      const minutesAway = Math.round(
        (event.scheduledAt.getTime() - now.getTime()) / 60_000,
      );
      const parts: string[] = [];
      if (event.level) parts.push(`level ${event.level}`);
      parts.push("bank stronghold");
      if (event.iconPreset) parts.push(`with marker **${event.iconPreset}**`);
      parts.push(`in **${minutesAway} minutes**`);
      if (event.coordX != null && event.coordY != null) {
        parts.push(`(${event.coordX}, ${event.coordY})`);
      }

      const message = `🏰 We take the ${parts.join(" ")}`;

      for (const channelId of channels) {
        const ok = await postDiscordChannelMessage(channelId, message);
        if (ok) posted++;
        else skipped++;
      }

      await db
        .update(schema.battlePlanCaptureEvents)
        .set({ discordAnnouncedAt: now })
        .where(eq(schema.battlePlanCaptureEvents.id, event.id));
    }
  }

  return { posted, skipped };
}

// ---------------------------------------------------------------------------
// Bank protection timer announcements
// ---------------------------------------------------------------------------

const PROTECTION_MILESTONES_HOURS = [72, 48, 24, 12, 6, 1, 0] as const;

function currentMilestone(hoursRemaining: number): number | null {
  for (const m of PROTECTION_MILESTONES_HOURS) {
    if (hoursRemaining <= m) return m;
  }
  return null;
}

function depositTermAdvice(hoursRemaining: number): string | null {
  if (hoursRemaining <= 0) return "Protection expired — bank is vulnerable!";
  if (hoursRemaining <= 24) return "Limit all new deposits to **1 day**.";
  if (hoursRemaining <= 48) return "Safe deposit term is now **3 days** max.";
  if (hoursRemaining <= 72) return "Safe deposit term is now **3 days**.";
  return null;
}

export async function processBankProtectionAnnouncements(): Promise<{
  posted: number;
  skipped: number;
}> {
  const targets = await listGuildsWithBankingChannel();
  if (targets.length === 0) return { posted: 0, skipped: 0 };

  const channelsByAlliance = groupByAlliance(targets);
  const now = new Date();
  const db = getDb();
  let posted = 0;
  let skipped = 0;

  for (const [allianceId, channels] of channelsByAlliance) {
    const banks = await db
      .select()
      .from(schema.banks)
      .where(
        and(
          eq(schema.banks.allianceId, allianceId),
          isNotNull(schema.banks.protectionExpiresAt),
        ),
      );

    for (const bank of banks) {
      if (!bank.protectionExpiresAt) continue;

      const msRemaining = bank.protectionExpiresAt.getTime() - now.getTime();
      const hoursRemaining = msRemaining / (60 * 60 * 1000);

      if (hoursRemaining > PROTECTION_MILESTONES_HOURS[0]!) {
        continue;
      }
      if (hoursRemaining < -1) {
        continue;
      }

      const milestone = currentMilestone(hoursRemaining);
      if (milestone === null) continue;

      const lastMilestone = bank.discordProtectionLastMilestone;
      if (lastMilestone !== null && lastMilestone <= milestone) {
        continue;
      }

      const bankLabel = `Bank Lv${bank.level} (${bank.coordX}, ${bank.coordY})`;
      const timerLine =
        milestone === 0
          ? `⚠️ **${bankLabel}** — protection has expired!`
          : `⏱️ **${bankLabel}** — protection timer down to **${milestone}h**.`;

      const advice = depositTermAdvice(hoursRemaining);
      const message = advice ? `${timerLine}\n${advice}` : timerLine;

      for (const channelId of channels) {
        const ok = await postDiscordChannelMessage(channelId, message);
        if (ok) posted++;
        else skipped++;
      }

      await db
        .update(schema.banks)
        .set({ discordProtectionLastMilestone: milestone })
        .where(eq(schema.banks.id, bank.id));
    }
  }

  return { posted, skipped };
}

// ---------------------------------------------------------------------------
// Combined entry point for the cron
// ---------------------------------------------------------------------------

export async function processBattlePlanAnnouncements(): Promise<{
  capture: { posted: number; skipped: number };
  protection: { posted: number; skipped: number };
}> {
  const [capture, protection] = await Promise.all([
    processPreCaptureAnnouncements(),
    processBankProtectionAnnouncements(),
  ]);
  return { capture, protection };
}
