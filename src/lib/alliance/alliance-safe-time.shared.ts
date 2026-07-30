export const ALLIANCE_SAFE_TIME_SLOTS = ["04", "12", "20"] as const;
export type AllianceSafeTimeSlot = (typeof ALLIANCE_SAFE_TIME_SLOTS)[number];

const SLOT_START_HOUR: Record<AllianceSafeTimeSlot, number> = {
  "04": 4,
  "12": 12,
  "20": 20,
};

export function isAllianceSafeTimeSlot(
  value: string | null | undefined,
): value is AllianceSafeTimeSlot {
  return (
    value != null &&
    (ALLIANCE_SAFE_TIME_SLOTS as readonly string[]).includes(value)
  );
}

export function allianceSafeTimeSlotStartHour(
  slot: AllianceSafeTimeSlot,
): number {
  return SLOT_START_HOUR[slot];
}

export function allianceSafeTimeSlotI18nKey(
  slot: AllianceSafeTimeSlot,
): `slot${"04" | "12" | "20"}` {
  return `slot${slot}`;
}
