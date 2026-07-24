import {
  VS_PERFORMANCE_DAY_MESSAGE_KEYS,
  type VsPerformanceDayKey,
  vsPerformanceDayMetaForDate,
} from "@/lib/video/vs-recorded-date.shared";
import { sanitizeDiscordPlainText } from "@/lib/vs-performance/buster-day-reminders.shared";

export const VS_PERFORMANCE_DISCORD_TOP_N = 5;

export const VS_PERFORMANCE_DAY_LABELS: Record<VsPerformanceDayKey, string> = {
  [VS_PERFORMANCE_DAY_MESSAGE_KEYS[1]]: "Radar Training",
  [VS_PERFORMANCE_DAY_MESSAGE_KEYS[2]]: "Base Expansion",
  [VS_PERFORMANCE_DAY_MESSAGE_KEYS[3]]: "Age of Science",
  [VS_PERFORMANCE_DAY_MESSAGE_KEYS[4]]: "Train Heroes",
  [VS_PERFORMANCE_DAY_MESSAGE_KEYS[5]]: "Total Mobilization",
  [VS_PERFORMANCE_DAY_MESSAGE_KEYS[6]]: "Enemy Buster",
};

export type VsPerformanceDiscordEntry = {
  rank: number;
  memberName: string;
  score: string;
};

export type VsPerformanceDiscordRow = {
  rank?: number | null;
  memberName?: string | null;
  ocrName?: string | null;
  score?: string | null;
  deleted?: number | null;
};

const PODIUM_MEDALS = ["🥇", "🥈", "🥉"] as const;

function compareNullableRankAsc(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function displayMemberName(row: VsPerformanceDiscordRow): string {
  const raw = row.memberName?.trim() || row.ocrName?.trim() || "Unknown";
  return sanitizeDiscordPlainText(raw);
}

function displayScore(score: string | null | undefined): string {
  const trimmed = score?.trim();
  return trimmed ? trimmed : "—";
}

/** Top VS rows by in-game rank (1 = best), excluding deleted rows. */
export function buildVsPerformanceDiscordTopEntries(
  rows: VsPerformanceDiscordRow[],
  topN = VS_PERFORMANCE_DISCORD_TOP_N,
): VsPerformanceDiscordEntry[] {
  const active = rows.filter((row) => row.deleted !== 1);
  const sorted = [...active].sort((a, b) => {
    const byRank = compareNullableRankAsc(a.rank, b.rank);
    if (byRank !== 0) return byRank;
    return displayMemberName(a).localeCompare(displayMemberName(b));
  });

  return sorted.slice(0, topN).map((row, index) => ({
    rank: row.rank ?? index + 1,
    memberName: displayMemberName(row),
    score: displayScore(row.score),
  }));
}

export function formatVsPerformanceDiscordEntryLine(
  entry: Pick<VsPerformanceDiscordEntry, "rank" | "memberName" | "score">,
): string {
  return `#${entry.rank} ${entry.memberName} — ${entry.score}`;
}

export function formatVsPerformanceDayHeading(input: {
  recordedDate?: string | null;
  vsPeriod?: "daily" | "weekly";
}): string | null {
  const recordedDate = input.recordedDate?.trim().slice(0, 10);
  if (!recordedDate) return null;

  if (input.vsPeriod === "weekly") {
    return `Week ending Sunday (${recordedDate})`;
  }

  const meta = vsPerformanceDayMetaForDate(recordedDate);
  if (!meta) return recordedDate;
  const dayLabel = VS_PERFORMANCE_DAY_LABELS[meta.vsDayKey];
  return `Day ${meta.vsDayNumber} · ${dayLabel} (${recordedDate})`;
}

function formatTopEntryLines(entries: VsPerformanceDiscordEntry[]): string[] {
  return entries.map((entry, index) => {
    const medal = PODIUM_MEDALS[index];
    const line = formatVsPerformanceDiscordEntryLine(entry);
    return medal ? `${medal} **${line}**` : `• ${line}`;
  });
}

export function formatVsPerformanceParsedDiscordMessage(input: {
  memberCount: number;
  entries: VsPerformanceDiscordEntry[];
  reviewUrl?: string | null;
}): string {
  const lines =
    input.entries.length > 0
      ? formatTopEntryLines(input.entries)
      : ["No ranked scores recognized yet."];

  const footer = input.reviewUrl?.trim()
    ? `\n\nReview & submit: ${input.reviewUrl.trim()}`
    : "";

  return (
    `**VS Performance — parsed, ready for review**\n` +
    `${input.memberCount} member${input.memberCount === 1 ? "" : "s"} recognized. Top scores:\n\n` +
    lines.join("\n") +
    footer
  );
}

export function formatVsPerformanceFinalizedDiscordMessage(input: {
  dayHeading: string;
  submittedCount: number;
  entries: VsPerformanceDiscordEntry[];
  vsPerformanceUrl?: string | null;
}): string {
  const lines =
    input.entries.length > 0
      ? formatTopEntryLines(input.entries)
      : ["No scores submitted."];

  const footer = input.vsPerformanceUrl?.trim()
    ? `\n\nView in Alliance HQ: ${input.vsPerformanceUrl.trim()}`
    : "";

  return (
    `**VS Performance — ${input.dayHeading}**\n` +
    `Submitted ${input.submittedCount} score${input.submittedCount === 1 ? "" : "s"}.\n\n` +
    lines.join("\n") +
    footer
  );
}
