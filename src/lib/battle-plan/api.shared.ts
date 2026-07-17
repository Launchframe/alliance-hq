import { isMarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import {
  CAPTURE_POLICIES,
  CAPTURE_EVENT_STATUSES,
  TERRITORY_TYPES,
  type CaptureEventStatus,
  type CapturePolicy,
  type SerializedBattlePlanSettings,
  type SerializedCaptureEvent,
  type TerritoryType,
} from "@/lib/battle-plan/types.shared";
import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import {
  BATTLE_PLAN_EVENT_TYPES,
  type BattlePlanEventType,
} from "@/lib/banks/types.shared";

export type CaptureEventPayload = {
  scheduledAt: string;
  territoryType: TerritoryType;
  iconPreset?: MarkerIconPreset | null;
  capturePolicy?: CapturePolicy | null;
  notes?: string | null;
  status?: CaptureEventStatus;
  eventType?: BattlePlanEventType;
  bankId?: string | null;
  gameServerNumber?: number | null;
  coordX?: number | null;
  coordY?: number | null;
  level?: number | null;
};

export type BattlePlanSettingsPayload = {
  defaultCapturePolicy?: CapturePolicy;
  /** Phase 2: Discord report toggle — API accepts the flag; no settings UI in phase 1. */
  discordReportsEnabled?: boolean;
  planRevision: number;
};

export function isCapturePolicy(value: string): value is CapturePolicy {
  return (CAPTURE_POLICIES as readonly string[]).includes(value);
}

export function isTerritoryType(value: string): value is TerritoryType {
  return (TERRITORY_TYPES as readonly string[]).includes(value);
}

export function isCaptureEventStatus(value: string): value is CaptureEventStatus {
  return (CAPTURE_EVENT_STATUSES as readonly string[]).includes(value);
}

export function isBattlePlanEventType(
  value: string,
): value is BattlePlanEventType {
  return (BATTLE_PLAN_EVENT_TYPES as readonly string[]).includes(value);
}

export function serializeBattlePlanSettings(
  row: {
    defaultCapturePolicy: string;
    planRevision: number;
    discordReportsEnabled: number;
    updatedAt: Date;
  },
): SerializedBattlePlanSettings {
  return {
    defaultCapturePolicy: isCapturePolicy(row.defaultCapturePolicy)
      ? row.defaultCapturePolicy
      : "peace",
    planRevision: row.planRevision,
    discordReportsEnabled: row.discordReportsEnabled === 1,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeCaptureEvent(
  row: {
    id: string;
    eventType?: string | null;
    scheduledAt: Date;
    serverCalendarDate: string;
    territoryType: string;
    iconPreset?: string | null;
    capturePolicy: string | null;
    notes: string | null;
    status: string;
    bankId?: string | null;
    gameServerNumber?: number | null;
    coordX?: number | null;
    coordY?: number | null;
    level?: number | null;
    createdAt: Date;
    updatedAt: Date;
  },
  defaultCapturePolicy: CapturePolicy,
): SerializedCaptureEvent {
  const capturePolicy =
    row.capturePolicy && isCapturePolicy(row.capturePolicy)
      ? row.capturePolicy
      : null;
  const iconPreset =
    row.iconPreset && isMarkerIconPreset(row.iconPreset)
      ? row.iconPreset
      : null;
  const eventType =
    row.eventType && isBattlePlanEventType(row.eventType)
      ? row.eventType
      : "capture";
  return {
    id: row.id,
    eventType,
    scheduledAt: row.scheduledAt.toISOString(),
    serverCalendarDate: row.serverCalendarDate,
    territoryType: isTerritoryType(row.territoryType)
      ? row.territoryType
      : "stronghold",
    iconPreset,
    capturePolicy,
    effectiveCapturePolicy: capturePolicy ?? defaultCapturePolicy,
    notes: row.notes,
    status: isCaptureEventStatus(row.status) ? row.status : "scheduled",
    bankId: row.bankId ?? null,
    gameServerNumber: row.gameServerNumber ?? null,
    coordX: row.coordX ?? null,
    coordY: row.coordY ?? null,
    level: row.level ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function validateCaptureEventPayload(
  body: CaptureEventPayload,
): string | null {
  if (!body.scheduledAt?.trim()) {
    return "scheduledAt is required.";
  }
  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return "scheduledAt must be a valid ISO timestamp.";
  }
  const eventType = body.eventType ?? "capture";
  if (!isBattlePlanEventType(eventType)) {
    return "eventType must be capture or drop.";
  }
  if (!body.territoryType || !isTerritoryType(body.territoryType)) {
    return "territoryType must be stronghold or city.";
  }
  if (body.iconPreset != null && !isMarkerIconPreset(body.iconPreset)) {
    return "iconPreset must be a supported marker preset.";
  }
  const status = body.status ?? "scheduled";
  if (status === "scheduled" && !body.iconPreset) {
    return "iconPreset is required for scheduled captures.";
  }
  if (eventType === "capture") {
    if (!body.capturePolicy || !isCapturePolicy(body.capturePolicy)) {
      return "capturePolicy must be peace or war.";
    }
  } else if (
    body.capturePolicy != null &&
    !isCapturePolicy(body.capturePolicy)
  ) {
    return "capturePolicy must be peace or war.";
  }
  if (eventType === "drop" && !body.bankId?.trim()) {
    return "bankId is required for drop events.";
  }
  if (body.status != null && !isCaptureEventStatus(body.status)) {
    return "status must be scheduled, completed, or cancelled.";
  }
  return null;
}

export function validateBattlePlanSettingsPayload(
  body: BattlePlanSettingsPayload,
): string | null {
  if (typeof body.planRevision !== "number" || body.planRevision < 0) {
    return "planRevision is required.";
  }
  if (
    body.defaultCapturePolicy != null &&
    !isCapturePolicy(body.defaultCapturePolicy)
  ) {
    return "defaultCapturePolicy must be peace or war.";
  }
  return null;
}

export function capturePolicyLabel(policy: CapturePolicy): string {
  return policy === "peace" ? "In-and-out" : "All gas, no brakes";
}
