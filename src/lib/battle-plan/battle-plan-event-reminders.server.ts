import "server-only";

import type { BattlePlanEventType } from "@/lib/banks/types.shared";
import {
  materializeBattlePlanReminderInboxItem,
  deactivateBattlePlanReminderInboxItems,
} from "@/lib/battle-plan/capture-reminder-inbox.server";
import {
  CAPTURE_REMINDER_INBOX_KIND,
  DEPOSIT_WINDOW_REMINDER_INBOX_KIND,
  type BattlePlanReminderInboxKind,
} from "@/lib/battle-plan/capture-reminder-inbox.shared";
import type { TerritoryType } from "@/lib/battle-plan/types.shared";

type CaptureEventReminderRow = {
  id: string;
  eventType: BattlePlanEventType | string | null;
  territoryType: TerritoryType | string;
  status: string | null;
  notes: string | null;
  level: number | null;
  coordX: number | null;
  coordY: number | null;
};

export function resolveBattlePlanReminderKind(
  row: Pick<CaptureEventReminderRow, "eventType" | "territoryType">,
): BattlePlanReminderInboxKind | null {
  const eventType = row.eventType ?? "capture";
  if (eventType === "capture" && row.territoryType === "stronghold") {
    return CAPTURE_REMINDER_INBOX_KIND;
  }
  if (eventType === "deposit_window") {
    return DEPOSIT_WINDOW_REMINDER_INBOX_KIND;
  }
  return null;
}

export function buildBattlePlanReminderTitle(row: CaptureEventReminderRow): string {
  const eventType = row.eventType ?? "capture";
  if (eventType === "deposit_window") {
    if (row.level != null && row.coordX != null && row.coordY != null) {
      return `Deposit window: Lv${row.level} (${row.coordX}, ${row.coordY})`;
    }
    return "Deposit window reminder";
  }
  return row.notes?.trim()
    ? `Stronghold capture: ${row.notes.trim()}`
    : "Stronghold capture";
}

export async function syncBattlePlanReminderInboxForEvent(
  allianceId: string,
  row: CaptureEventReminderRow & { scheduledAt: Date },
): Promise<void> {
  const kind = resolveBattlePlanReminderKind(row);
  const isScheduled = (row.status ?? "scheduled") === "scheduled";
  if (kind && isScheduled) {
    await materializeBattlePlanReminderInboxItem({
      allianceId,
      captureEventId: row.id,
      scheduledAt: row.scheduledAt,
      title: buildBattlePlanReminderTitle(row),
      kind,
    });
    return;
  }
  await deactivateBattlePlanReminderInboxItems(row.id);
}
