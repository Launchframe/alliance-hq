import "server-only";

import { sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import {
  computeNextIntervalOccurrence,
  computeWeeklyOccurrencesInWindow,
  serverTimestampFromCalendarAndTime,
  type EurWeeklySlot,
} from "@/lib/eur/schedule-engine";
import {
  isRegularEventUploadReminderKey,
  REGULAR_EVENT_UPLOAD_REMINDER_DELAY_MINUTES,
  regularEventLabel,
} from "@/lib/regular-events/catalog.shared";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import {
  materializeRegularEventReminderInboxItem,
  materializeRegularEventUploadReminderInboxItem,
} from "@/lib/regular-events/inbox.server";
import {
  getLastOccurrenceForRule,
  insertRegularEventOccurrence,
  listActiveRegularEventScheduleRules,
  listAllianceIdsWithActiveRegularEventRules,
  listAlliancesWithRegularEventsAnnouncementsEnabled,
  listDueRegularEventOccurrences,
  listDueRegularEventScheduleReminders,
  listDueRegularEventUploadReminders,
  markRegularEventOccurrenceAnnounced,
  markRegularEventOccurrenceScheduleReminded,
  markRegularEventOccurrenceUploadReminded,
} from "@/lib/regular-events/repository.server";
import { announceAtFromStart } from "@/lib/regular-events/schedule.shared";
import {
  expandOneShotDatesInRange,
  isBiweeklyOnWeek,
} from "@/lib/regular-events/schedule-validation.shared";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";
import {
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/game-time";

const LOOKAHEAD_HOURS = 48;

type ChannelTarget = {
  guildId: string;
  allianceId: string;
  channelId: string;
};

export async function listGuildsWithRegularEventsChannel(): Promise<
  ChannelTarget[]
> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      allianceId: schema.discordGuildAlliances.allianceId,
      channelId: schema.discordGuildAlliances.regularEventsChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(
      sql`${schema.discordGuildAlliances.regularEventsChannelId} is not null`,
    );
  return rows.filter((r): r is ChannelTarget => Boolean(r.channelId?.trim()));
}

export async function listGuildsWithR4Channel(): Promise<ChannelTarget[]> {
  const db = getDb();
  const rows = await db
    .select({
      guildId: schema.discordGuildAlliances.guildId,
      allianceId: schema.discordGuildAlliances.allianceId,
      channelId: schema.discordGuildAlliances.r4ChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(sql`${schema.discordGuildAlliances.r4ChannelId} is not null`);
  return rows.filter((r): r is ChannelTarget => Boolean(r.channelId?.trim()));
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

function formatTimeStFromScheduledStart(scheduledStartAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SERVER_TIME_IANA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(scheduledStartAt);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

export function formatRegularEventAnnouncementMessage(input: {
  eventKey: string;
  scheduledStartAt: Date;
  locale?: "en-US" | "pt-BR";
}): string {
  const t = createDiscordTranslator(input.locale ?? "en-US");
  const event = regularEventLabel(input.eventKey);
  const time = formatTimeStFromScheduledStart(input.scheduledStartAt);
  return t("regularEvents.startsInOneHour", { event, time });
}

export function formatRegularEventUploadReminderTitle(input: {
  eventKey: string;
}): string {
  return `Upload scores for today's ${regularEventLabel(input.eventKey)}`;
}

export function formatRegularEventScheduleInGameReminder(input: {
  eventKey: string;
  scheduledStartAt: Date;
  locale?: "en-US" | "pt-BR";
}): string {
  const t = createDiscordTranslator(input.locale ?? "en-US");
  const event = regularEventLabel(input.eventKey);
  const time = formatTimeStFromScheduledStart(input.scheduledStartAt);
  return t("regularEvents.scheduleInGameAtReset", { event, time });
}

export function uploadReminderAtFromStart(scheduledStartAt: Date): Date {
  return new Date(
    scheduledStartAt.getTime() +
      REGULAR_EVENT_UPLOAD_REMINDER_DELAY_MINUTES * 60 * 1000,
  );
}

function scoreTargetIdForRegularEvent(eventKey: string): string | null {
  if (eventKey === "marshal_guard") return "alliance-exercise";
  if (eventKey === "zombie_siege") return "zombie-siege";
  return null;
}

function computeOnceOccurrencesInWindow(
  dates: string[],
  timeSt: string,
  windowStart: Date,
  windowEnd: Date,
): Array<{ occurrenceDate: string; scheduledStartAt: Date }> {
  const rangeStart = getServerCalendarDate(windowStart);
  const rangeEnd = getServerCalendarDate(windowEnd);
  const out: Array<{ occurrenceDate: string; scheduledStartAt: Date }> = [];
  for (const date of expandOneShotDatesInRange(dates, rangeStart, rangeEnd)) {
    const scheduledStartAt = serverTimestampFromCalendarAndTime(date, timeSt);
    if (scheduledStartAt >= windowStart && scheduledStartAt <= windowEnd) {
      out.push({ occurrenceDate: date, scheduledStartAt });
    }
  }
  return out;
}

function computeBiweeklyOccurrencesInWindow(
  slots: EurWeeklySlot[],
  phaseMonday: string,
  windowStart: Date,
  windowEnd: Date,
): Array<{ occurrenceDate: string; scheduledStartAt: Date }> {
  const weekly = computeWeeklyOccurrencesInWindow(slots, windowStart, windowEnd);
  return weekly.filter((slot) =>
    isBiweeklyOnWeek(getWeekStartMonday(slot.occurrenceDate), phaseMonday),
  );
}

export async function processDueRegularEventUploadReminders(
  now = new Date(),
): Promise<{ uploadInbox: number }> {
  const due = await listDueRegularEventUploadReminders(
    now,
    REGULAR_EVENT_UPLOAD_REMINDER_DELAY_MINUTES,
  );
  let uploadInbox = 0;

  for (const occurrence of due) {
    if (!isRegularEventUploadReminderKey(occurrence.eventKey)) {
      await markRegularEventOccurrenceUploadReminded(occurrence.id, now);
      continue;
    }
    const scoreTarget = scoreTargetIdForRegularEvent(occurrence.eventKey);
    if (!scoreTarget) {
      await markRegularEventOccurrenceUploadReminded(occurrence.id, now);
      continue;
    }

    const visibleAfter = uploadReminderAtFromStart(occurrence.scheduledStartAt);
    await materializeRegularEventUploadReminderInboxItem({
      allianceId: occurrence.allianceId,
      occurrenceId: occurrence.id,
      title: formatRegularEventUploadReminderTitle({
        eventKey: occurrence.eventKey,
      }),
      href: buildVideoUploadHref(scoreTarget, {
        recordedDate: occurrence.occurrenceDate,
      }),
      scoreTarget,
      visibleAfter,
    });
    await markRegularEventOccurrenceUploadReminded(occurrence.id, now);
    uploadInbox += 1;
  }

  return { uploadInbox };
}

export async function materializeRegularEventOccurrences(
  now = new Date(),
): Promise<{ occurrencesCreated: number }> {
  const allianceIds = await listAllianceIdsWithActiveRegularEventRules();
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
  let occurrencesCreated = 0;

  for (const allianceId of allianceIds) {
    const rules = await listActiveRegularEventScheduleRules(allianceId);
    for (const rule of rules) {
      const slots: Array<{ occurrenceDate: string; scheduledStartAt: Date }> =
        [];

      if (rule.scheduleKind === "weekly" && rule.weeklySlots) {
        const weeklySlots = rule.weeklySlots as EurWeeklySlot[];
        slots.push(
          ...computeWeeklyOccurrencesInWindow(weeklySlots, now, windowEnd),
        );
      } else if (
        rule.scheduleKind === "biweekly" &&
        rule.weeklySlots &&
        rule.biweeklyPhaseMonday
      ) {
        slots.push(
          ...computeBiweeklyOccurrencesInWindow(
            rule.weeklySlots as EurWeeklySlot[],
            rule.biweeklyPhaseMonday,
            now,
            windowEnd,
          ),
        );
      } else if (rule.scheduleKind === "once" && rule.oneShotDates) {
        const dates = (rule.oneShotDates as string[]) ?? [];
        const timeSt =
          rule.anchorTimeSt ??
          (rule.weeklySlots as EurWeeklySlot[] | null)?.[0]?.timeSt ??
          "23:00";
        slots.push(
          ...computeOnceOccurrencesInWindow(dates, timeSt, now, windowEnd),
        );
      } else if (
        rule.scheduleKind === "interval_after_last" &&
        rule.intervalDays &&
        rule.anchorTimeSt
      ) {
        const last = await getLastOccurrenceForRule(rule.id);
        const next = computeNextIntervalOccurrence(
          last,
          rule.intervalDays,
          rule.anchorTimeSt,
          now,
          windowEnd,
        );
        if (next) slots.push(next);
      }

      for (const slot of slots) {
        const id = await insertRegularEventOccurrence({
          scheduleRuleId: rule.id,
          allianceId,
          eventKey: rule.eventKey,
          occurrenceDate: slot.occurrenceDate,
          scheduledStartAt: slot.scheduledStartAt,
          announceAt: announceAtFromStart(
            slot.scheduledStartAt,
            rule.announceLeadMinutes,
          ),
        });
        if (id) occurrencesCreated += 1;
      }
    }
  }

  return { occurrencesCreated };
}

export async function processDueRegularEventAnnouncements(
  now = new Date(),
): Promise<{ posted: number; skipped: number; inbox: number }> {
  const targets = await listGuildsWithRegularEventsChannel();
  const channelsByAlliance = groupByAlliance(targets);
  const enabledIds = new Set(
    await listAlliancesWithRegularEventsAnnouncementsEnabled(),
  );

  const due = await listDueRegularEventOccurrences(now);
  let posted = 0;
  let skipped = 0;
  let inbox = 0;

  for (const occurrence of due) {
    if (!enabledIds.has(occurrence.allianceId)) {
      await markRegularEventOccurrenceAnnounced(occurrence.id, now);
      skipped += 1;
      continue;
    }

    const message = formatRegularEventAnnouncementMessage({
      eventKey: occurrence.eventKey,
      scheduledStartAt: occurrence.scheduledStartAt,
    });

    await materializeRegularEventReminderInboxItem({
      allianceId: occurrence.allianceId,
      occurrenceId: occurrence.id,
      title: message,
      visibleAfter: occurrence.announceAt,
    });
    inbox += 1;

    const channels = channelsByAlliance.get(occurrence.allianceId) ?? [];
    if (channels.length === 0) {
      skipped += 1;
    } else {
      for (const channelId of channels) {
        const ok = await postDiscordChannelMessage(channelId, message);
        if (ok) posted += 1;
        else skipped += 1;
      }
    }

    await markRegularEventOccurrenceAnnounced(occurrence.id, now);
  }

  return { posted, skipped, inbox };
}

export async function processDueRegularEventScheduleReminders(
  now = new Date(),
): Promise<{ schedulePosted: number; scheduleSkipped: number }> {
  const targets = await listGuildsWithR4Channel();
  const channelsByAlliance = groupByAlliance(targets);
  const due = await listDueRegularEventScheduleReminders(now);
  let schedulePosted = 0;
  let scheduleSkipped = 0;

  for (const occurrence of due) {
    const message = formatRegularEventScheduleInGameReminder({
      eventKey: occurrence.eventKey,
      scheduledStartAt: occurrence.scheduledStartAt,
    });
    const channels = channelsByAlliance.get(occurrence.allianceId) ?? [];
    if (channels.length === 0) {
      scheduleSkipped += 1;
    } else {
      for (const channelId of channels) {
        const ok = await postDiscordChannelMessage(channelId, message);
        if (ok) schedulePosted += 1;
        else scheduleSkipped += 1;
      }
    }
    await markRegularEventOccurrenceScheduleReminded(occurrence.id, now);
  }

  return { schedulePosted, scheduleSkipped };
}

export async function processRegularEventAnnouncements(
  now = new Date(),
): Promise<{
  occurrencesCreated: number;
  posted: number;
  skipped: number;
  inbox: number;
  uploadInbox: number;
  schedulePosted: number;
  scheduleSkipped: number;
}> {
  const { occurrencesCreated } = await materializeRegularEventOccurrences(now);
  const result = await processDueRegularEventAnnouncements(now);
  const { uploadInbox } = await processDueRegularEventUploadReminders(now);
  const schedule = await processDueRegularEventScheduleReminders(now);
  return { occurrencesCreated, ...result, uploadInbox, ...schedule };
}
