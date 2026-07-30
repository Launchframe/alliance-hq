import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";
import type { BattlePlanEventType } from "@/lib/banks/types.shared";

export function findScheduledBankBattlePlanEvent(
  events: readonly SerializedCaptureEvent[],
  bankId: string,
  eventType: BattlePlanEventType,
): SerializedCaptureEvent | null {
  return (
    events.find(
      (event) =>
        event.bankId === bankId &&
        event.eventType === eventType &&
        event.status === "scheduled",
    ) ?? null
  );
}

/** Map marker shown on bank list rows — scheduled drop wins over deposit window. */
export function resolveBankListMarkerPreset(
  events: readonly SerializedCaptureEvent[],
  bankId: string,
): MarkerIconPreset | null {
  const drop = findScheduledBankBattlePlanEvent(events, bankId, "drop");
  if (drop?.iconPreset) {
    return drop.iconPreset;
  }
  const depositWindow = findScheduledBankBattlePlanEvent(
    events,
    bankId,
    "deposit_window",
  );
  return depositWindow?.iconPreset ?? null;
}
