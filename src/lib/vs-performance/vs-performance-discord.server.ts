import "server-only";

import { eq } from "drizzle-orm";

import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getDb, schema } from "@/lib/db";
import {
  buildVsPerformanceDiscordTopEntries,
  formatVsPerformanceDayHeading,
  formatVsPerformanceFinalizedDiscordMessage,
  formatVsPerformanceParsedDiscordMessage,
  type VsPerformanceDiscordRow,
} from "@/lib/vs-performance/vs-performance-discord.shared";
import { listRegisteredGuildsWithVsPerformanceChannel } from "@/lib/vr/repository";

function reviewUrlForJob(jobId: string, locale: DiscordBotLocale = "en-US"): string | null {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) return null;
  return buildDiscordBotAppUrl(locale, `/tools/video-upload/${jobId}/review`);
}

function vsPerformanceUrlForLocale(locale: DiscordBotLocale = "en-US"): string | null {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) return null;
  return buildDiscordBotAppUrl(locale, "/vs-performance");
}

async function loadParsedRowsForDiscord(
  parseSessionId: string,
): Promise<VsPerformanceDiscordRow[]> {
  const db = getDb();
  return db
    .select({
      rank: schema.parsedRows.rank,
      memberName: schema.parsedRows.memberName,
      ocrName: schema.parsedRows.ocrName,
      score: schema.parsedRows.score,
      deleted: schema.parsedRows.deleted,
    })
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, parseSessionId));
}

async function postVsPerformanceDiscordMessage(
  allianceId: string,
  message: string,
): Promise<{ posted: number; skipped: number }> {
  const channels = await listRegisteredGuildsWithVsPerformanceChannel();
  const allianceChannels = channels.filter(
    (target) => target.allianceId === allianceId,
  );
  if (allianceChannels.length === 0) {
    return { posted: 0, skipped: 1 };
  }

  let posted = 0;
  let skipped = 0;
  for (const target of allianceChannels) {
    const ok = await postDiscordChannelMessage(target.channelId, message);
    if (ok) posted += 1;
    else skipped += 1;
  }

  return { posted, skipped };
}

export async function announceVsPerformanceParsedToDiscord(input: {
  allianceId: string;
  jobId: string;
  parseSessionId: string;
}): Promise<{ posted: number; skipped: number }> {
  const rows = await loadParsedRowsForDiscord(input.parseSessionId);
  const activeRows = rows.filter((row) => row.deleted !== 1);
  if (activeRows.length === 0) {
    return { posted: 0, skipped: 1 };
  }

  const message = formatVsPerformanceParsedDiscordMessage({
    memberCount: activeRows.length,
    entries: buildVsPerformanceDiscordTopEntries(activeRows),
    reviewUrl: reviewUrlForJob(input.jobId),
  });

  return postVsPerformanceDiscordMessage(input.allianceId, message);
}

export async function announceVsPerformanceFinalizedToDiscord(input: {
  allianceId: string;
  recordedDate: string;
  vsPeriod?: "daily" | "weekly";
  rows: VsPerformanceDiscordRow[];
}): Promise<{ posted: number; skipped: number }> {
  const activeRows = input.rows.filter((row) => row.deleted !== 1);
  if (activeRows.length === 0) {
    return { posted: 0, skipped: 1 };
  }

  const dayHeading =
    formatVsPerformanceDayHeading({
      recordedDate: input.recordedDate,
      vsPeriod: input.vsPeriod,
    }) ?? input.recordedDate;

  const message = formatVsPerformanceFinalizedDiscordMessage({
    dayHeading,
    submittedCount: activeRows.length,
    entries: buildVsPerformanceDiscordTopEntries(activeRows),
    vsPerformanceUrl: vsPerformanceUrlForLocale(),
  });

  return postVsPerformanceDiscordMessage(input.allianceId, message);
}
