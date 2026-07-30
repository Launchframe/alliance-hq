import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";
import type { BankBattlePlanSnapshot } from "@/lib/banks/types.shared";
import type { SerializedBank } from "@/lib/banks/types.shared";

type SyncParams = {
  bank: SerializedBank;
  iconPreset: MarkerIconPreset | null;
  protectionExpiresAt: Date | null;
  existingEvent: SerializedCaptureEvent | null;
  battlePlan: BankBattlePlanSnapshot;
};

export async function syncDepositWindowBattlePlanEvent(
  params: SyncParams,
): Promise<BankBattlePlanSnapshot> {
  const { bank, iconPreset, protectionExpiresAt, existingEvent, battlePlan } =
    params;

  if (!iconPreset) {
    if (!existingEvent) {
      return battlePlan;
    }
    const response = await fetch(`/api/battle-plan/events/${existingEvent.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planRevision: battlePlan.settings.planRevision }),
    });
    if (!response.ok) {
      throw new Error("Failed to clear deposit-window marker.");
    }
    const data = (await response.json()) as {
      dashboard: { settings: BankBattlePlanSnapshot["settings"]; events: SerializedCaptureEvent[] };
    };
    return {
      settings: data.dashboard.settings,
      events: data.dashboard.events,
    };
  }

  if (!protectionExpiresAt) {
    throw new Error("Protection timing is required for a deposit-window marker.");
  }

  const payload = {
    scheduledAt: protectionExpiresAt.toISOString(),
    territoryType: "stronghold" as const,
    iconPreset,
    eventType: "deposit_window" as const,
    bankId: bank.id,
    status: "scheduled" as const,
    gameServerNumber: bank.gameServerNumber,
    coordX: bank.coordX,
    coordY: bank.coordY,
    level: bank.level,
    planRevision: battlePlan.settings.planRevision,
  };

  const response = await fetch(
    existingEvent
      ? `/api/battle-plan/events/${existingEvent.id}`
      : "/api/battle-plan/events",
    {
      method: existingEvent ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(data?.error ?? "Failed to save deposit-window marker.");
  }
  const data = (await response.json()) as {
    dashboard: { settings: BankBattlePlanSnapshot["settings"]; events: SerializedCaptureEvent[] };
  };
  return {
    settings: data.dashboard.settings,
    events: data.dashboard.events,
  };
}

export async function createScheduledDropBattlePlanEvent(params: {
  bankId: string;
  scheduledAtIso: string;
  iconPreset: MarkerIconPreset;
  battlePlan: BankBattlePlanSnapshot;
}): Promise<BankBattlePlanSnapshot> {
  const response = await fetch("/api/battle-plan/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scheduledAt: params.scheduledAtIso,
      territoryType: "stronghold",
      iconPreset: params.iconPreset,
      eventType: "drop",
      bankId: params.bankId,
      status: "scheduled",
      planRevision: params.battlePlan.settings.planRevision,
    }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(data?.error ?? "Failed to schedule drop.");
  }
  const data = (await response.json()) as {
    dashboard: { settings: BankBattlePlanSnapshot["settings"]; events: SerializedCaptureEvent[] };
  };
  return {
    settings: data.dashboard.settings,
    events: data.dashboard.events,
  };
}
