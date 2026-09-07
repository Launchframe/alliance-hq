import "server-only";

import {
  fetchDiscordChannelName,
  fetchDiscordGuildName,
} from "@/lib/discord/guild-metadata.server";
import {
  listAllianceDiscordGuildTrainSetup,
} from "@/lib/vr/repository";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  isRegularEventKey,
  regularEventLabel,
} from "@/lib/regular-events/catalog.shared";
import {
  ensureDefaultRegularEventRules,
  refreshZombieSiegeTimesForCanyon,
} from "@/lib/regular-events/ensureDefaultRules.server";
import {
  deleteRegularEventScheduleRule,
  getAllianceRegularEventFlags,
  listRegularEventScheduleRules,
  setAllianceRegularEventAnnouncementsEnabled,
  setAllianceRegularEventsCanyonStormActive,
  updateRegularEventScheduleRuleById,
  upsertRegularEventScheduleRule,
} from "@/lib/regular-events/repository.server";
import type {
  RegularEventScheduleKind,
  RegularEventWeeklySlot,
} from "@/lib/regular-events/types.shared";
import { parseWeeklySlots } from "@/lib/regular-events/schedule.shared";
import type {
  RegularEventRuleDto,
  RegularEventsGuildLink,
  RegularEventsSettings,
} from "@/lib/regular-events/settings.shared";

export type {
  RegularEventRuleDto,
  RegularEventsGuildLink,
  RegularEventsSettings,
};

async function listRegularEventsChannelsForAlliance(
  allianceId: string,
): Promise<Array<{ guildId: string; channelId: string }>> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      channelId: schema.discordGuildAlliances.regularEventsChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(eq(schema.discordGuildAlliances.allianceId, allianceId));
  return rows
    .filter((r): r is { guildId: string; channelId: string } =>
      Boolean(r.channelId?.trim()),
    )
    .map((r) => ({ guildId: r.guildId, channelId: r.channelId! }));
}

async function enrichGuildLinks(
  allianceId: string,
): Promise<RegularEventsGuildLink[]> {
  const [guildRows, channels] = await Promise.all([
    listAllianceDiscordGuildTrainSetup(allianceId),
    listRegularEventsChannelsForAlliance(allianceId),
  ]);
  const channelByGuild = new Map(
    channels.map((c) => [c.guildId, c.channelId] as const),
  );

  return Promise.all(
    guildRows.map(async (guild) => {
      const channelId = channelByGuild.get(guild.guildId) ?? null;
      const [guildName, regularEventsChannelName] = await Promise.all([
        fetchDiscordGuildName(guild.guildId),
        channelId
          ? fetchDiscordChannelName(channelId)
          : Promise.resolve(null),
      ]);
      return {
        guildId: guild.guildId,
        guildName,
        hasRegularEventsChannel: Boolean(channelId),
        regularEventsChannelId: channelId,
        regularEventsChannelName,
        discordOpenUrl: channelId
          ? `https://discord.com/channels/${guild.guildId}/${channelId}`
          : guild.discordOpenUrl,
      };
    }),
  );
}

function toRuleDto(
  row: Awaited<ReturnType<typeof listRegularEventScheduleRules>>[number],
): RegularEventRuleDto {
  return {
    id: row.id,
    eventKey: row.eventKey,
    eventLabel: regularEventLabel(row.eventKey),
    scheduleKind: row.scheduleKind,
    weeklySlots: (row.weeklySlots as RegularEventWeeklySlot[] | null) ?? null,
    intervalDays: row.intervalDays,
    anchorTimeSt: row.anchorTimeSt,
    announceLeadMinutes: row.announceLeadMinutes,
    active: row.active === 1,
  };
}

export async function loadRegularEventsSettings(
  allianceId: string,
  canManage: boolean,
): Promise<RegularEventsSettings> {
  const [flags, channels, guilds, rules] = await Promise.all([
    getAllianceRegularEventFlags(allianceId),
    listRegularEventsChannelsForAlliance(allianceId),
    enrichGuildLinks(allianceId),
    listRegularEventScheduleRules(allianceId),
  ]);

  return {
    announcementsEnabled: flags.announcementsEnabled,
    canyonStormActive: flags.canyonStormActive,
    guildChannelCount: channels.length,
    guilds,
    rules: rules.map(toRuleDto),
    canManage,
  };
}

export async function saveRegularEventsSettings(
  allianceId: string,
  input: {
    announcementsEnabled?: boolean;
    canyonStormActive?: boolean;
    upsertRule?: {
      eventKey: string;
      scheduleKind: RegularEventScheduleKind;
      weeklySlots?: unknown;
      intervalDays?: number | null;
      anchorTimeSt?: string | null;
      announceLeadMinutes?: number;
      active?: boolean;
    };
    updateRule?: {
      ruleId: string;
      scheduleKind?: RegularEventScheduleKind;
      weeklySlots?: unknown;
      intervalDays?: number | null;
      anchorTimeSt?: string | null;
      announceLeadMinutes?: number;
      active?: boolean;
    };
    deleteRuleId?: string;
  },
  canManage: boolean,
): Promise<RegularEventsSettings> {
  if (input.announcementsEnabled !== undefined) {
    await setAllianceRegularEventAnnouncementsEnabled(
      allianceId,
      input.announcementsEnabled,
    );
    if (input.announcementsEnabled) {
      const flags = await getAllianceRegularEventFlags(allianceId);
      await ensureDefaultRegularEventRules({
        allianceId,
        canyonStormActive: flags.canyonStormActive,
      });
    }
  }

  if (input.canyonStormActive !== undefined) {
    await setAllianceRegularEventsCanyonStormActive(
      allianceId,
      input.canyonStormActive,
    );
    await refreshZombieSiegeTimesForCanyon({
      allianceId,
      canyonStormActive: input.canyonStormActive,
    });
  }

  if (input.upsertRule) {
    const eventKey = input.upsertRule.eventKey;
    if (!isRegularEventKey(eventKey)) {
      throw new Error("Invalid event key.");
    }
    const weeklySlots =
      input.upsertRule.weeklySlots === undefined
        ? undefined
        : parseWeeklySlots(input.upsertRule.weeklySlots);
    if (
      input.upsertRule.weeklySlots !== undefined &&
      weeklySlots === null
    ) {
      throw new Error("Invalid weekly slots.");
    }
    await upsertRegularEventScheduleRule({
      allianceId,
      eventKey,
      scheduleKind: input.upsertRule.scheduleKind,
      weeklySlots: weeklySlots ?? null,
      intervalDays: input.upsertRule.intervalDays,
      anchorTimeSt: input.upsertRule.anchorTimeSt,
      announceLeadMinutes: input.upsertRule.announceLeadMinutes,
      active: input.upsertRule.active,
    });
  }

  if (input.updateRule) {
    const weeklySlots =
      input.updateRule.weeklySlots === undefined
        ? undefined
        : parseWeeklySlots(input.updateRule.weeklySlots);
    if (
      input.updateRule.weeklySlots !== undefined &&
      weeklySlots === null
    ) {
      throw new Error("Invalid weekly slots.");
    }
    const updated = await updateRegularEventScheduleRuleById({
      allianceId,
      ruleId: input.updateRule.ruleId,
      scheduleKind: input.updateRule.scheduleKind,
      weeklySlots,
      intervalDays: input.updateRule.intervalDays,
      anchorTimeSt: input.updateRule.anchorTimeSt,
      announceLeadMinutes: input.updateRule.announceLeadMinutes,
      active: input.updateRule.active,
    });
    if (!updated) {
      throw new Error("Schedule rule not found.");
    }
  }

  if (input.deleteRuleId) {
    const deleted = await deleteRegularEventScheduleRule(
      allianceId,
      input.deleteRuleId,
    );
    if (!deleted) {
      throw new Error("Schedule rule not found.");
    }
  }

  return loadRegularEventsSettings(allianceId, canManage);
}
