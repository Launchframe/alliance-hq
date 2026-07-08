export type TrainDiscordStatusRecord = {
  date: string;
  conductorMemberName: string | null;
  vipMemberName: string | null;
  lockedAt: string | null;
};

export function formatTrainReadyMessage(input: {
  conductorName: string;
  vipName?: string | null;
  date: string;
  trainsUrl?: string | null;
}): string {
  const vipLine = input.vipName?.trim()
    ? `\nVIP: **${input.vipName.trim()}**`
    : "";
  const footer = input.trainsUrl?.trim()
    ? `\n\nManage trains: ${input.trainsUrl.trim()}`
    : "";
  return (
    `Today's train conductor (${input.date}): **${input.conductorName.trim()}**` +
    `${vipLine}\n\nThe train is on the platform.` +
    footer
  );
}

export function formatTrainDepartingSoonMessage(input: {
  conductorName: string;
  date: string;
  trainsUrl?: string | null;
}): string {
  const footer = input.trainsUrl?.trim()
    ? `\n\n${input.trainsUrl.trim()}`
    : "";
  return (
    `Reminder: **${input.conductorName.trim()}**'s train (${input.date}) departs soon. Last chance to board.` +
    footer
  );
}

export function formatTrainStatusReply(record: TrainDiscordStatusRecord): string {
  if (!record.conductorMemberName?.trim()) {
    return `No conductor selected yet for **${record.date}**.`;
  }
  const vipLine = record.vipMemberName?.trim()
    ? `\nVIP: **${record.vipMemberName.trim()}**`
    : "";
  const lockLine = record.lockedAt
    ? "\nStatus: **locked** — train is on the platform."
    : "\nStatus: **draft** — run `/train-is-ready` or lock in Alliance HQ when ready.";
  return (
    `Conductor for **${record.date}**: **${record.conductorMemberName.trim()}**` +
    `${vipLine}${lockLine}`
  );
}

/** Hours after lock before departing-soon reminder (1h before 4h platform window ends). */
export const TRAIN_DEPARTING_SOON_ELAPSED_HOURS = 3;

export const TRAIN_PLATFORM_WINDOW_HOURS = 4;

export function groupTrainChannelsByAlliance(
  targets: Array<{ guildId: string; allianceId: string; channelId: string }>,
): Map<string, Array<{ guildId: string; channelId: string }>> {
  const byAlliance = new Map<string, Array<{ guildId: string; channelId: string }>>();
  for (const target of targets) {
    const channels = byAlliance.get(target.allianceId) ?? [];
    channels.push({ guildId: target.guildId, channelId: target.channelId });
    byAlliance.set(target.allianceId, channels);
  }
  return byAlliance;
}
