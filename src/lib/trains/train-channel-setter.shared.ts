export const TRAIN_CHANNEL_SETTER_MIN_RANKS = ["officer", "owner"] as const;

export type TrainChannelSetterMinRank =
  (typeof TRAIN_CHANNEL_SETTER_MIN_RANKS)[number];

export function parseTrainChannelSetterMinRank(
  value: string | null | undefined,
): TrainChannelSetterMinRank {
  return value === "owner" ? "owner" : "officer";
}

export function isTrainChannelSetterMinRank(
  value: string,
): value is TrainChannelSetterMinRank {
  return (TRAIN_CHANNEL_SETTER_MIN_RANKS as readonly string[]).includes(value);
}

/** Pure gate for Discord `/set-train-channel` callers. */
export function canSetTrainChannel(input: {
  minRank: TrainChannelSetterMinRank;
  isOwner: boolean;
  isOfficer: boolean;
}): boolean {
  if (input.isOwner) return true;
  if (input.minRank === "owner") return false;
  return input.isOfficer;
}
