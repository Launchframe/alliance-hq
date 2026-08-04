import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { buildVsDailyAnnouncementPreview } from "@/lib/vs-calculator/announcement-build.server";
import { listActiveVsCatalogDefs } from "@/lib/vs-calculator/inventory.server";

type ChannelTarget = {
  guildId: string;
  allianceId: string;
  channelId: string;
};

export async function listGuildsWithVsAnnouncementsChannel(): Promise<
  ChannelTarget[]
> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      allianceId: schema.discordGuildAlliances.allianceId,
      channelId: schema.discordGuildAlliances.vsAnnouncementsChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(
      sql`${schema.discordGuildAlliances.vsAnnouncementsChannelId} is not null`,
    );
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

export async function processVsDailyAnnouncements(options?: {
  now?: Date;
}): Promise<{ posted: number; skipped: number }> {
  const targets = await listGuildsWithVsAnnouncementsChannel();
  if (targets.length === 0) return { posted: 0, skipped: 0 };

  const channelsByAlliance = groupByAlliance(targets);
  const today = getServerCalendarDate(options?.now);
  const targetDate = addCalendarDays(today, 1);
  const db = getDb();
  let posted = 0;
  let skipped = 0;

  const catalog = await listActiveVsCatalogDefs();

  for (const [allianceId, channels] of channelsByAlliance) {
    const [existing] = await db
      .select({ id: schema.vsAnnouncementPosts.id })
      .from(schema.vsAnnouncementPosts)
      .where(
        and(
          eq(schema.vsAnnouncementPosts.allianceId, allianceId),
          eq(schema.vsAnnouncementPosts.targetDate, targetDate),
        ),
      )
      .limit(1);

    if (existing) {
      skipped += channels.length;
      continue;
    }

    const { message } = await buildVsDailyAnnouncementPreview({
      allianceId,
      locale: "en-US",
      now: options?.now,
      catalog,
    });

    let alliancePosted = false;
    for (const channelId of channels) {
      const ok = await postDiscordChannelMessage(channelId, message);
      if (ok) {
        alliancePosted = true;
        posted += 1;
      } else {
        skipped += 1;
      }
    }

    if (alliancePosted) {
      await db.insert(schema.vsAnnouncementPosts).values({
        id: nanoid(),
        allianceId,
        targetDate,
      });
    }
  }

  return { posted, skipped };
}
