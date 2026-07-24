import "server-only";

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { resolveAppOrigin } from "@/lib/app-origin";
import { listGuildsWithRegularEventsChannel } from "@/lib/battle-plan/discord-announcements.server";
import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getOrCreateBusterDayReport } from "@/lib/vs-performance/buster-day-reports.server";
import { sendBusterDayReminderEmails } from "@/lib/vs-performance/buster-day-reminder-email.server";
import { isBusterDaySnapshotComplete } from "@/lib/vs-performance/buster-day.shared";
import {
  buildBusterDayReminderDiscordMessage,
  resolveBusterDayReminderKind,
  type BusterDayReminderKind,
} from "@/lib/vs-performance/buster-day-reminders.shared";
import { getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";

export type BusterDayReminderPassResult = {
  kind: BusterDayReminderKind | null;
  alliancesConsidered: number;
  skippedComplete: number;
  skippedAlreadySent: number;
  discordPosted: number;
  emailsSent: number;
  markedSent: number;
};

async function listAshedLinkedAllianceIds(): Promise<
  Array<{ id: string; tag: string }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .where(isNotNull(schema.alliances.ashedAllianceId));
  return rows.map((r) => ({
    id: r.id,
    tag: r.tag?.trim() || r.id.slice(0, 8),
  }));
}

async function markBusterDayReminderSent(input: {
  reportId: string;
  kind: BusterDayReminderKind;
  sentAt: Date;
}): Promise<boolean> {
  const db = getDb();
  const column =
    input.kind === "pre"
      ? schema.busterDayReports.preReminderSentAt
      : schema.busterDayReports.postReminderSentAt;

  const updated = await db
    .update(schema.busterDayReports)
    .set({
      ...(input.kind === "pre"
        ? { preReminderSentAt: input.sentAt }
        : { postReminderSentAt: input.sentAt }),
      updatedAt: input.sentAt,
    })
    .where(and(eq(schema.busterDayReports.id, input.reportId), isNull(column)))
    .returning({ id: schema.busterDayReports.id });

  return updated.length > 0;
}

/**
 * Fan out Friday 20:00 ST / Sunday 00:00 ST Buster Day snapshot reminders
 * (Discord regular-events channel + processor/owner/maintainer email).
 */
export async function runBusterDayReminderPass(
  now = new Date(),
): Promise<BusterDayReminderPassResult> {
  const kind = resolveBusterDayReminderKind(now);
  if (!kind) {
    return {
      kind: null,
      alliancesConsidered: 0,
      skippedComplete: 0,
      skippedAlreadySent: 0,
      discordPosted: 0,
      emailsSent: 0,
      markedSent: 0,
    };
  }

  const alliances = await listAshedLinkedAllianceIds();
  const guildTargets = await listGuildsWithRegularEventsChannel();
  const channelsByAlliance = new Map<string, string[]>();
  for (const t of guildTargets) {
    const list = channelsByAlliance.get(t.allianceId) ?? [];
    list.push(t.channelId);
    channelsByAlliance.set(t.allianceId, list);
  }

  const vsWeekMonday = getWeekStartMonday(getServerCalendarDate(now));
  const wizardUrl = `${resolveAppOrigin()}/vs-performance/buster-day`;
  const sentAt = now;

  let skippedComplete = 0;
  let skippedAlreadySent = 0;
  let discordPosted = 0;
  let emailsSent = 0;
  let markedSent = 0;

  for (const alliance of alliances) {
    const report = await getOrCreateBusterDayReport(alliance.id, vsWeekMonday);

    if (kind === "pre") {
      if (report.preReminderSentAt) {
        skippedAlreadySent += 1;
        continue;
      }
      if (
        isBusterDaySnapshotComplete({
          rosterJobId: report.preRosterJobId,
          killsJobId: report.preKillsJobId,
        })
      ) {
        skippedComplete += 1;
        continue;
      }
    } else {
      if (report.postReminderSentAt) {
        skippedAlreadySent += 1;
        continue;
      }
      if (
        isBusterDaySnapshotComplete({
          rosterJobId: report.postRosterJobId,
          killsJobId: report.postKillsJobId,
        })
      ) {
        skippedComplete += 1;
        continue;
      }
    }

    const discordMessage = buildBusterDayReminderDiscordMessage({
      kind,
      allianceTag: alliance.tag,
      wizardUrl,
    });
    const channels = channelsByAlliance.get(alliance.id) ?? [];
    let allianceDiscord = 0;
    for (const channelId of channels) {
      const ok = await postDiscordChannelMessage(channelId, discordMessage);
      if (ok) allianceDiscord += 1;
    }
    discordPosted += allianceDiscord;

    const emailResult = await sendBusterDayReminderEmails({
      allianceId: alliance.id,
      allianceTag: alliance.tag,
      kind,
      wizardUrl,
    });
    emailsSent += emailResult.sent;

    // Mark sent only when at least one channel succeeded so failed runs retry.
    if (allianceDiscord > 0 || emailResult.sent > 0) {
      const marked = await markBusterDayReminderSent({
        reportId: report.id,
        kind,
        sentAt,
      });
      if (marked) markedSent += 1;
    }
  }

  return {
    kind,
    alliancesConsidered: alliances.length,
    skippedComplete,
    skippedAlreadySent,
    discordPosted,
    emailsSent,
    markedSent,
  };
}
