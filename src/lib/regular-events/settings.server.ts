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
import {
  parseOneShotDatesPatch,
  parseWeeklySlotsPatch,
} from "@/lib/regular-events/schedule.shared";
import {
  expandBiweeklySlotsToDates,
  expandIntervalDatesInRange,
  expandOneShotDatesInRange,
  expandWeeklySlotsToDates,
  validateBiweeklySlotsForEvent,
  validateEventScheduleDates,
  validateSkyGlacierAlternating,
  validateWeeklySlotsForEvent,
  type ScheduleValidationCode,
} from "@/lib/regular-events/schedule-validation.shared";
import type {
  RegularEventRuleDto,
  RegularEventsGuildLink,
  RegularEventsSettings,
} from "@/lib/regular-events/settings.shared";
import {
  addCalendarDays,
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/game-time";

export type {
  RegularEventRuleDto,
  RegularEventsGuildLink,
  RegularEventsSettings,
};

export type RegularEventScheduleValidationCode = ScheduleValidationCode;

export class RegularEventScheduleValidationError extends Error {
  readonly code: RegularEventScheduleValidationCode;

  constructor(code: RegularEventScheduleValidationCode) {
    super(scheduleValidationMessage(code));
    this.name = "RegularEventScheduleValidationError";
    this.code = code;
  }
}

function rangeEndFromMonday(anchorMonday: string): string {
  return addCalendarDays(anchorMonday, 7 * 8 - 1);
}

function datesForRuleDraft(input: {
  eventKey: string;
  scheduleKind: RegularEventScheduleKind;
  weeklySlots?: RegularEventWeeklySlot[] | null;
  oneShotDates?: string[] | null;
  biweeklyPhaseMonday?: string | null;
  intervalDays?: number | null;
  anchorMonday: string;
  rangeEnd: string;
}): string[] {
  if (input.scheduleKind === "weekly") {
    return expandWeeklySlotsToDates(
      input.weeklySlots ?? [],
      input.anchorMonday,
      input.rangeEnd,
    );
  }
  if (input.scheduleKind === "biweekly") {
    if (!input.biweeklyPhaseMonday) return [];
    return expandBiweeklySlotsToDates(
      input.weeklySlots ?? [],
      input.biweeklyPhaseMonday,
      input.anchorMonday,
      input.rangeEnd,
    );
  }
  if (input.scheduleKind === "once") {
    return expandOneShotDatesInRange(
      input.oneShotDates ?? [],
      input.anchorMonday,
      input.rangeEnd,
    );
  }
  if (input.scheduleKind === "interval_after_last") {
    return expandIntervalDatesInRange({
      intervalDays: input.intervalDays ?? 2,
      rangeStart: input.anchorMonday,
      rangeEnd: input.rangeEnd,
    });
  }
  return [];
}

function assertScheduleValid(input: {
  eventKey: string;
  scheduleKind: RegularEventScheduleKind;
  weeklySlots?: RegularEventWeeklySlot[] | null;
  oneShotDates?: string[] | null;
  biweeklyPhaseMonday?: string | null;
  intervalDays?: number | null;
  siblingRules?: Array<{
    eventKey: string;
    scheduleKind: RegularEventScheduleKind | string;
    weeklySlots: RegularEventWeeklySlot[] | null;
    oneShotDates: string[] | null;
    biweeklyPhaseMonday: string | null;
    intervalDays: number | null;
  }>;
}): void {
  if (!isRegularEventKey(input.eventKey)) {
    throw new RegularEventScheduleValidationError("invalid_event");
  }
  const today = getServerCalendarDate();
  const anchorMonday = getWeekStartMonday(today);
  const rangeEnd = rangeEndFromMonday(anchorMonday);

  if (input.scheduleKind === "weekly") {
    const result = validateWeeklySlotsForEvent(
      input.eventKey,
      input.weeklySlots ?? [],
      anchorMonday,
    );
    if (!result.ok) {
      throw new RegularEventScheduleValidationError(result.code);
    }
  } else if (input.scheduleKind === "biweekly") {
    const result = validateBiweeklySlotsForEvent(
      input.eventKey,
      input.weeklySlots ?? [],
      input.biweeklyPhaseMonday,
      anchorMonday,
    );
    if (!result.ok) {
      throw new RegularEventScheduleValidationError(result.code);
    }
  } else if (input.scheduleKind === "once") {
    const dates = expandOneShotDatesInRange(
      input.oneShotDates ?? [],
      anchorMonday,
      rangeEnd,
    );
    const result = validateEventScheduleDates(input.eventKey, dates);
    if (!result.ok) {
      throw new RegularEventScheduleValidationError(result.code);
    }
  } else if (input.scheduleKind === "interval_after_last") {
    const projectedDates = expandIntervalDatesInRange({
      intervalDays: input.intervalDays ?? 2,
      rangeStart: anchorMonday,
      rangeEnd,
    });
    const result = validateEventScheduleDates(
      input.eventKey,
      projectedDates,
    );
    if (!result.ok) {
      throw new RegularEventScheduleValidationError(result.code);
    }
  }

  if (
    input.siblingRules &&
    (input.eventKey === "sky_marshall" || input.eventKey === "glacierdon")
  ) {
    const draftDates = datesForRuleDraft({
      ...input,
      anchorMonday,
      rangeEnd,
    });
    const otherKey =
      input.eventKey === "sky_marshall" ? "glacierdon" : "sky_marshall";
    const other = input.siblingRules.find((r) => r.eventKey === otherKey);
    if (other) {
      const otherDates = datesForRuleDraft({
        eventKey: other.eventKey,
        scheduleKind: other.scheduleKind as RegularEventScheduleKind,
        weeklySlots: other.weeklySlots,
        oneShotDates: other.oneShotDates,
        biweeklyPhaseMonday: other.biweeklyPhaseMonday,
        intervalDays: other.intervalDays,
        anchorMonday,
        rangeEnd,
      });
      const skyDates =
        input.eventKey === "sky_marshall" ? draftDates : otherDates;
      const glacierdonDates =
        input.eventKey === "glacierdon" ? draftDates : otherDates;
      const alt = validateSkyGlacierAlternating(skyDates, glacierdonDates);
      if (!alt.ok) {
        throw new RegularEventScheduleValidationError(alt.code);
      }
    }
  }
}

function scheduleValidationMessage(
  code: RegularEventScheduleValidationCode,
): string {
  switch (code) {
    case "adjacent_days":
      return "Alliance Exercise cannot be scheduled on adjacent days.";
    case "min_gap_days":
      return "Zombie Siege needs at least two full days between events.";
    case "once_per_week":
      return "This event can be scheduled only once per week.";
    case "wed_fri_only":
      return "Sky Predator and Glacierdon can only be scheduled Wednesday–Friday.";
    case "alternating_week":
      return "Sky Predator and Glacierdon cannot be scheduled in the same week.";
    case "biweekly_phase":
      return "Bi-weekly events need at least one scheduled day to set the alternating week.";
    case "invalid_event":
      return "Invalid event key.";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

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

async function listR4ChannelsForAlliance(
  allianceId: string,
): Promise<Array<{ guildId: string; channelId: string }>> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      channelId: schema.discordGuildAlliances.r4ChannelId,
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
  const [guildRows, channels, r4Channels] = await Promise.all([
    listAllianceDiscordGuildTrainSetup(allianceId),
    listRegularEventsChannelsForAlliance(allianceId),
    listR4ChannelsForAlliance(allianceId),
  ]);
  const channelByGuild = new Map(
    channels.map((c) => [c.guildId, c.channelId] as const),
  );
  const r4ByGuild = new Map(
    r4Channels.map((c) => [c.guildId, c.channelId] as const),
  );

  return Promise.all(
    guildRows.map(async (guild) => {
      const channelId = channelByGuild.get(guild.guildId) ?? null;
      const r4ChannelId = r4ByGuild.get(guild.guildId) ?? null;
      const [guildName, regularEventsChannelName, r4ChannelName] =
        await Promise.all([
          fetchDiscordGuildName(guild.guildId),
          channelId
            ? fetchDiscordChannelName(channelId)
            : Promise.resolve(null),
          r4ChannelId
            ? fetchDiscordChannelName(r4ChannelId)
            : Promise.resolve(null),
        ]);
      return {
        guildId: guild.guildId,
        guildName,
        hasRegularEventsChannel: Boolean(channelId),
        regularEventsChannelId: channelId,
        regularEventsChannelName,
        hasR4Channel: Boolean(r4ChannelId),
        r4ChannelId,
        r4ChannelName,
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
    oneShotDates: (row.oneShotDates as string[] | null) ?? null,
    biweeklyPhaseMonday: row.biweeklyPhaseMonday ?? null,
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
  const [flags, channels, r4Channels, guilds, rules] = await Promise.all([
    getAllianceRegularEventFlags(allianceId),
    listRegularEventsChannelsForAlliance(allianceId),
    listR4ChannelsForAlliance(allianceId),
    enrichGuildLinks(allianceId),
    listRegularEventScheduleRules(allianceId),
  ]);

  return {
    announcementsEnabled: flags.announcementsEnabled,
    canyonStormActive: flags.canyonStormActive,
    guildChannelCount: channels.length,
    r4ChannelCount: r4Channels.length,
    guilds,
    rules: rules.map(toRuleDto),
    canManage,
  };
}

type RulePatch = {
  scheduleKind?: RegularEventScheduleKind;
  weeklySlots?: unknown;
  oneShotDates?: unknown;
  biweeklyPhaseMonday?: string | null;
  intervalDays?: number | null;
  anchorTimeSt?: string | null;
  announceLeadMinutes?: number;
  active?: boolean;
};

function parseRuleFields(patch: RulePatch): {
  weeklySlots: RegularEventWeeklySlot[] | null | undefined;
  oneShotDates: string[] | null | undefined;
} {
  // `null` is an explicit clear (calendar sends it when leaving once / weekly).
  const weekly = parseWeeklySlotsPatch(patch.weeklySlots);
  if (!weekly.ok) {
    throw new Error("Invalid weekly slots.");
  }
  const once = parseOneShotDatesPatch(patch.oneShotDates);
  if (!once.ok) {
    throw new Error("Invalid one-shot dates.");
  }
  return { weeklySlots: weekly.value, oneShotDates: once.value };
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
      oneShotDates?: unknown;
      biweeklyPhaseMonday?: string | null;
      intervalDays?: number | null;
      anchorTimeSt?: string | null;
      announceLeadMinutes?: number;
      active?: boolean;
    };
    updateRule?: {
      ruleId: string;
      scheduleKind?: RegularEventScheduleKind;
      weeklySlots?: unknown;
      oneShotDates?: unknown;
      biweeklyPhaseMonday?: string | null;
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

  const allRules = await listRegularEventScheduleRules(allianceId);
  const siblings = allRules.map((r) => ({
    eventKey: r.eventKey,
    scheduleKind: r.scheduleKind,
    weeklySlots: (r.weeklySlots as RegularEventWeeklySlot[] | null) ?? null,
    oneShotDates: (r.oneShotDates as string[] | null) ?? null,
    biweeklyPhaseMonday: r.biweeklyPhaseMonday ?? null,
    intervalDays: r.intervalDays,
  }));

  if (input.upsertRule) {
    const eventKey = input.upsertRule.eventKey;
    if (!isRegularEventKey(eventKey)) {
      throw new Error("Invalid event key.");
    }
    const { weeklySlots, oneShotDates } = parseRuleFields(input.upsertRule);
    assertScheduleValid({
      eventKey,
      scheduleKind: input.upsertRule.scheduleKind,
      weeklySlots: weeklySlots ?? null,
      oneShotDates: oneShotDates ?? null,
      biweeklyPhaseMonday: input.upsertRule.biweeklyPhaseMonday,
      intervalDays: input.upsertRule.intervalDays,
      siblingRules: siblings.filter((s) => s.eventKey !== eventKey),
    });
    await upsertRegularEventScheduleRule({
      allianceId,
      eventKey,
      scheduleKind: input.upsertRule.scheduleKind,
      weeklySlots: weeklySlots ?? null,
      oneShotDates: oneShotDates ?? null,
      biweeklyPhaseMonday: input.upsertRule.biweeklyPhaseMonday,
      intervalDays: input.upsertRule.intervalDays,
      anchorTimeSt: input.upsertRule.anchorTimeSt,
      announceLeadMinutes: input.upsertRule.announceLeadMinutes,
      active: input.upsertRule.active,
    });
  }

  if (input.updateRule) {
    const { weeklySlots, oneShotDates } = parseRuleFields(input.updateRule);
    const existing = allRules.find((r) => r.id === input.updateRule!.ruleId);
    if (!existing) {
      throw new Error("Schedule rule not found.");
    }
    const nextKind =
      input.updateRule.scheduleKind ??
      (existing.scheduleKind as RegularEventScheduleKind);
    const nextWeekly =
      weeklySlots === undefined
        ? ((existing.weeklySlots as RegularEventWeeklySlot[] | null) ?? null)
        : weeklySlots;
    const nextOnce =
      oneShotDates === undefined
        ? ((existing.oneShotDates as string[] | null) ?? null)
        : oneShotDates;
    const nextPhase =
      input.updateRule.biweeklyPhaseMonday === undefined
        ? existing.biweeklyPhaseMonday
        : input.updateRule.biweeklyPhaseMonday;
    assertScheduleValid({
      eventKey: existing.eventKey,
      scheduleKind: nextKind,
      weeklySlots: nextWeekly,
      oneShotDates: nextOnce,
      biweeklyPhaseMonday: nextPhase,
      intervalDays:
        input.updateRule.intervalDays === undefined
          ? existing.intervalDays
          : input.updateRule.intervalDays,
      siblingRules: siblings.filter((s) => s.eventKey !== existing.eventKey),
    });
    const updated = await updateRegularEventScheduleRuleById({
      allianceId,
      ruleId: input.updateRule.ruleId,
      scheduleKind: input.updateRule.scheduleKind,
      weeklySlots,
      oneShotDates,
      biweeklyPhaseMonday: input.updateRule.biweeklyPhaseMonday,
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
