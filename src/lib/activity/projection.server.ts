import "server-only";

import type { ActivityEventRecord } from "@/lib/db/schema";

import {
  ActivityReadError,
  activityAllowedScopes,
  type ActivityPrincipal,
} from "./access.server";
import { activityCatalog, isActivityEventKey } from "./catalog.shared";
import {
  safeActivityServerNumber,
  safeVisibleName,
} from "./privacy.shared";
import type {
  ActivityFeedItem,
  ActivityFeedScope,
  ActivityFeedValues,
} from "./feed.shared";
import {
  ACTIVITY_CHANNELS,
  ACTIVITY_METHODS,
  ACTIVITY_RANKS,
  ACTIVITY_ROLES,
  ACTIVITY_SEVERITIES,
  type ActivityRank,
  type ActivityRole,
  type ActivityTool,
} from "./types.shared";

export { safeActivityServerNumber, safeVisibleName };

/** HQ and Discord ids are free text. A whole-column game UID or email must not become an actor key. */
export function safeActorKey(
  kind: "hq" | "discord",
  id: string | null,
): string | null {
  if (id === null) {
    return null;
  }
  const trimmed = id.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 200 ||
    trimmed.includes("@") ||
    /\s/.test(trimmed) ||
    /^\d{12,16}$/.test(trimmed)
  ) {
    return null;
  }
  return `${kind}:${trimmed}`;
}

function invalidRecord(): ActivityReadError {
  return new ActivityReadError("invalid_record", 500);
}

function closedValue<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | null {
  if (value === null) {
    return null;
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw invalidRecord();
  }
  return value as T;
}

export function projectActivityRecord(
  row: ActivityEventRecord,
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
): ActivityFeedItem {
  if (!activityAllowedScopes(principal).includes(scope)) {
    throw new ActivityReadError("forbidden", 403);
  }
  if (
    scope === "personal" &&
    row.personalOwnerHqUserId !== principal.hqUserId
  ) {
    throw new ActivityReadError("forbidden", 403);
  }
  if (
    scope === "alliance" &&
    (row.allianceId !== principal.currentAllianceId ||
      row.visibilityClass !== "alliance")
  ) {
    throw new ActivityReadError("forbidden", 403);
  }
  if (row.schemaVersion !== 1 || !isActivityEventKey(row.eventKey)) {
    throw invalidRecord();
  }
  const entry = activityCatalog[row.eventKey];
  if (
    row.feature !== entry.feature ||
    row.kind !== entry.kind ||
    row.visibilityClass !== entry.visibility
  ) {
    throw invalidRecord();
  }

  const parsed = entry.payload.safeParse(row.payload);
  if (!parsed.success) {
    throw invalidRecord();
  }
  const payload = parsed.data as Record<string, unknown>;

  const values: ActivityFeedValues = {};
  if (typeof payload.value === "string") {
    values.value = payload.value;
  }
  if (typeof payload.member === "string") {
    values.member = safeVisibleName(payload.member);
  }
  if (typeof payload.fromRank === "string") {
    values.fromRank = payload.fromRank as ActivityRank;
  }
  if (typeof payload.toRank === "string") {
    values.toRank = payload.toRank as ActivityRank;
  }
  if (typeof payload.rank === "string") {
    values.rank = payload.rank as ActivityRank;
  }
  if (typeof payload.fromRole === "string") {
    values.fromRole = payload.fromRole as ActivityRole;
  }
  if (typeof payload.toRole === "string") {
    values.toRole = payload.toRole as ActivityRole;
  }
  if (typeof payload.tool === "string") {
    values.tool = payload.tool as ActivityTool;
  }

  const details: ActivityFeedItem["details"] = {};
  if (scope !== "personal") {
    if ("previousValue" in payload) {
      details.previousValue = payload.previousValue as string | null;
    }
    if (typeof payload.affected === "number") {
      details.affected = payload.affected;
    }
    if (typeof payload.completed === "number") {
      details.completed = payload.completed;
    }
  }

  const actor =
    scope === "personal"
      ? null
      : {
          key:
            row.originalHqUserId !== null
              ? safeActorKey("hq", row.originalHqUserId)
              : safeActorKey("discord", row.originalDiscordUserId),
          displayName: safeVisibleName(row.actorDisplayName),
          hqRole: closedValue(row.actorHqRole, ACTIVITY_ROLES),
          gameRank: closedValue(row.actorGameRank, ACTIVITY_RANKS),
          unlinkedHq:
            row.actorKind === "discord" && row.originalHqUserId === null,
        };

  const alliance =
    row.allianceId === null
      ? null
      : {
          id: row.allianceId,
          serverNumber: safeActivityServerNumber(row.serverNumber),
          tag: safeVisibleName(row.allianceTag),
          name: safeVisibleName(row.allianceName),
        };

  const severity = closedValue(row.severity, ACTIVITY_SEVERITIES);
  if (severity === null) {
    throw invalidRecord();
  }

  const item: ActivityFeedItem = {
    id: row.id,
    occurredAt: row.occurredAt,
    eventKey: row.eventKey,
    feature: entry.feature,
    kind: entry.kind,
    descriptor: entry.descriptor,
    resource: entry.resource,
    values,
    details,
    actor,
    alliance,
    channel: closedValue(row.channel, ACTIVITY_CHANNELS),
    method: closedValue(row.method, ACTIVITY_METHODS),
    severity,
    historical: row.historical,
    historicalCurrentLabels: row.historicalCurrentLabels,
  };

  if (scope === "global" && row.visibilityClass === "private") {
    return {
      ...item,
      values: {},
      details: {},
      actor: null,
    };
  }

  return item;
}
