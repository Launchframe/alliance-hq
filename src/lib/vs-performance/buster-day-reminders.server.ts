import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { resolveAppOrigin } from "@/lib/app-origin";
import { listGuildsWithRegularEventsChannel } from "@/lib/battle-plan/discord-announcements.server";
import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getOrCreateBusterDayReport } from "@/lib/vs-performance/buster-day-reports.server";
import {
  listBusterDayReminderEmails,
  sendBusterDayReminderEmails,
} from "@/lib/vs-performance/buster-day-reminder-email.server";
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

async function listAllianceIdsWithReminderEmailRecipients(): Promise<string[]> {
  const db = getDb();
  const [processorRows, adminRows] = await Promise.all([
    db
      .selectDistinct({ allianceId: schema.allianceVideoProcessors.allianceId })
      .from(schema.allianceVideoProcessors),
    db
      .selectDistinct({ allianceId: schema.allianceMemberships.allianceId })
      .from(schema.allianceMemberships)
      .innerJoin(
        schema.roles,
        eq(schema.roles.id, schema.allianceMemberships.roleId),
      )
      .where(inArray(schema.roles.name, ["owner", "maintainer"])),
  ]);
  return [
    ...new Set([
      ...processorRows.map((r) => r.allianceId),
      ...adminRows.map((r) => r.allianceId),
    ]),
  ];
}

async function listBusterDayReminderTargets(
  channelsByAlliance: Map<string, string[]>,
): Promise<Array<{ id: string; tag: string }>> {
  const candidateIds = new Set(channelsByAlliance.keys());
  for (const allianceId of await listAllianceIdsWithReminderEmailRecipients()) {
    candidateIds.add(allianceId);
  }
  if (candidateIds.size === 0) return [];

  const db = getDb();
  const rows = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .where(inArray(schema.alliances.id, [...candidateIds]));

  return rows.map((r) => ({
    id: r.id,
    tag: r.tag?.trim() || r.id.slice(0, 8),
  }));
}

async function claimBusterDayReminderSent(input: {
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

async function releaseBusterDayReminderSent(input: {
  reportId: string;
  kind: BusterDayReminderKind;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.busterDayReports)
    .set({
      ...(input.kind === "pre"
        ? { preReminderSentAt: null }
        : { postReminderSentAt: null }),
      updatedAt: new Date(),
    })
    .where(eq(schema.busterDayReports.id, input.reportId));
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

  const guildTargets = await listGuildsWithRegularEventsChannel();
  const channelsByAlliance = new Map<string, string[]>();
  for (const t of guildTargets) {
    const list = channelsByAlliance.get(t.allianceId) ?? [];
    list.push(t.channelId);
    channelsByAlliance.set(t.allianceId, list);
  }

  const alliances = await listBusterDayReminderTargets(channelsByAlliance);
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
    const alreadySent =
      kind === "pre" ? report.preReminderSentAt : report.postReminderSentAt;
    if (alreadySent) {
      skippedAlreadySent += 1;
      continue;
    }

    const snapshotComplete =
      kind === "pre"
        ? isBusterDaySnapshotComplete({
            rosterJobId: report.preRosterJobId,
            killsJobId: report.preKillsJobId,
          })
        : isBusterDaySnapshotComplete({
            rosterJobId: report.postRosterJobId,
            killsJobId: report.postKillsJobId,
          });
    if (snapshotComplete) {
      skippedComplete += 1;
      continue;
    }

    const channels = channelsByAlliance.get(alliance.id) ?? [];
    const emailRecipients = await listBusterDayReminderEmails(alliance.id);
    if (channels.length === 0 && emailRecipients.length === 0) {
      continue;
    }

    const claimed = await claimBusterDayReminderSent({
      reportId: report.id,
      kind,
      sentAt,
    });
    if (!claimed) {
      skippedAlreadySent += 1;
      continue;
    }

    let allianceDiscord = 0;
    let emailSent = 0;
    try {
      const discordMessage = buildBusterDayReminderDiscordMessage({
        kind,
        allianceTag: alliance.tag,
        wizardUrl,
      });
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
      emailSent = emailResult.sent;
      emailsSent += emailSent;

      if (allianceDiscord > 0 || emailSent > 0) {
        markedSent += 1;
      } else {
        await releaseBusterDayReminderSent({ reportId: report.id, kind });
      }
    } catch (error) {
      if (allianceDiscord === 0 && emailSent === 0) {
        await releaseBusterDayReminderSent({ reportId: report.id, kind });
      }
      throw error;
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
