import "server-only";

import { sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import {
  computeNextIntervalOccurrence,
  computeWeeklyOccurrencesInWindow,
  type EurWeeklySlot,
} from "@/lib/eur/schedule-engine";
import { regularEventLabel } from "@/lib/regular-events/catalog.shared";
import { materializeRegularEventReminderInboxItem } from "@/lib/regular-events/inbox.server";
import {
  getLastOccurrenceForRule,
  insertRegularEventOccurrence,
  listActiveRegularEventScheduleRules,
  listAlliancesWithRegularEventsAnnouncementsEnabled,
  listDueRegularEventOccurrences,
  markRegularEventOccurrenceAnnounced,
} from "@/lib/regular-events/repository.server";
import { announceAtFromStart } from "@/lib/regular-events/schedule.shared";

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
  // Server time is UTC−2; reconstruct HH:MM from the instant.
  const shifted = new Date(scheduledStartAt.getTime() + 2 * 60 * 60 * 1000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
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

export async function materializeRegularEventOccurrences(
  now = new Date(),
): Promise<{ occurrencesCreated: number }> {
  const allianceIds =
    await listAlliancesWithRegularEventsAnnouncementsEnabled();
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

export async function processRegularEventAnnouncements(
  now = new Date(),
): Promise<{
  occurrencesCreated: number;
  posted: number;
  skipped: number;
  inbox: number;
}> {
  const { occurrencesCreated } = await materializeRegularEventOccurrences(now);
  const result = await processDueRegularEventAnnouncements(now);
  return { occurrencesCreated, ...result };
}
