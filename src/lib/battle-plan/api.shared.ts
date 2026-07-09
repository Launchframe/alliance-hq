import {
  BATTLE_PLAN_MARKER_NUMBERS,
  CAPTURE_POLICIES,
  CAPTURE_EVENT_STATUSES,
  TERRITORY_TYPES,
  type BattlePlanMarkerNumber,
  type CaptureEventStatus,
  type CapturePolicy,
  type SerializedBattlePlanMarker,
  type SerializedBattlePlanSettings,
  type SerializedCaptureEvent,
  type TerritoryType,
} from "@/lib/battle-plan/types.shared";

export type CaptureEventPayload = {
  scheduledAt: string;
  territoryType: TerritoryType;
  markerNumber: BattlePlanMarkerNumber;
  capturePolicy?: CapturePolicy | null;
  notes?: string | null;
  status?: CaptureEventStatus;
};

export type BattlePlanSettingsPayload = {
  defaultCapturePolicy?: CapturePolicy;
  discordReportsEnabled?: boolean;
  planRevision: number;
};

export type BattlePlanMarkerPayload = {
  label?: string | null;
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

export function isMarkerNumber(value: number): value is BattlePlanMarkerNumber {
  return (BATTLE_PLAN_MARKER_NUMBERS as readonly number[]).includes(value);
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

export function serializeBattlePlanMarker(row: {
  id: string;
  markerNumber: number;
  label: string | null;
  updatedAt: Date;
}): SerializedBattlePlanMarker {
  return {
    id: row.id,
    markerNumber: row.markerNumber as BattlePlanMarkerNumber,
    label: row.label,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeCaptureEvent(
  row: {
    id: string;
    scheduledAt: Date;
    serverCalendarDate: string;
    territoryType: string;
    markerNumber: number;
    capturePolicy: string | null;
    notes: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  defaultCapturePolicy: CapturePolicy,
): SerializedCaptureEvent {
  const capturePolicy =
    row.capturePolicy && isCapturePolicy(row.capturePolicy)
      ? row.capturePolicy
      : null;
  return {
    id: row.id,
    scheduledAt: row.scheduledAt.toISOString(),
    serverCalendarDate: row.serverCalendarDate,
    territoryType: isTerritoryType(row.territoryType)
      ? row.territoryType
      : "stronghold",
    markerNumber: row.markerNumber as BattlePlanMarkerNumber,
    capturePolicy,
    effectiveCapturePolicy: capturePolicy ?? defaultCapturePolicy,
    notes: row.notes,
    status: isCaptureEventStatus(row.status) ? row.status : "scheduled",
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
  if (!body.territoryType || !isTerritoryType(body.territoryType)) {
    return "territoryType must be stronghold or city.";
  }
  if (!isMarkerNumber(body.markerNumber)) {
    return "markerNumber must be between 1 and 5.";
  }
  if (
    body.capturePolicy != null &&
    !isCapturePolicy(body.capturePolicy)
  ) {
    return "capturePolicy must be peace or war.";
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
