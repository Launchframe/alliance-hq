import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

import {
  activityCatalog,
  parseActivityEvent,
  type ActivityEventInput,
} from "./catalog.shared";
import { ActivityWriteError, toActivityWriteError } from "./errors.server";
import { scheduleActivityBlockedAlert } from "./monitoring.server";
import { resolveActivityPersonalOwner } from "./ownership.server";
import { ACTIVITY_SCHEMA_VERSION } from "./types.shared";

export type ActivityTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

function canonicalizeForHash(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeForHash);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalizeForHash(entry)]),
    );
  }
  return value;
}

function logActivityWriteSignal(
  signal: "activity_write_attempt" | "activity_write_success" | "activity_write_failure",
  fields: Record<string, string | number | null>,
): void {
  const line = JSON.stringify({ signal, ...fields });
  if (signal === "activity_write_failure") {
    console.error(line);
    return;
  }
  console.info(line);
}

export async function appendActivityEvent(
  tx: ActivityTransaction,
  input: ActivityEventInput,
): Promise<{ id: string; inserted: boolean }> {
  const startedAt = Date.now();
  const hintedKey =
    typeof input === "object" && input !== null
      ? (input as { eventKey?: unknown }).eventKey
      : undefined;

  try {
    const parsed = parseActivityEvent(input);
    if (!parsed.success) {
      throw new ActivityWriteError({
        eventKey: hintedKey,
        failureCategory: "validation",
      });
    }
    const event = parsed.data;
    const entry = activityCatalog[event.eventKey];

    logActivityWriteSignal("activity_write_attempt", {
      eventKey: event.eventKey,
    });

    const content = {
      schemaVersion: ACTIVITY_SCHEMA_VERSION,
      eventKey: event.eventKey,
      feature: entry.feature,
      kind: entry.kind,
      occurredAt:
        event.occurredAt instanceof Date
          ? event.occurredAt.toISOString().replace(/Z$/, "000Z")
          : event.occurredAt,
      allianceId: event.scope.allianceId,
      actorKind: event.actor.kind,
      originalHqUserId: event.actor.hqUserId,
      originalDiscordUserId: event.actor.discordUserId,
      personalOwnerHqUserId: event.actor.personalOwnerHqUserId,
      actorCommanderId: event.actor.commanderId,
      actorDisplayName: event.actor.displayName,
      actorHqRole: event.actor.hqRole,
      actorGameRank: event.actor.gameRank,
      serverNumber: event.scope.serverNumber,
      allianceTag: event.scope.allianceTag,
      allianceName: event.scope.allianceName,
      channel: event.channel,
      method: event.method,
      severity: event.severity,
      visibilityClass: entry.visibility,
      resourceKind: entry.resource,
      resourceId: event.resourceId ?? null,
      payload: event.payload,
      sourceNamespace: event.source.namespace,
      sourceKey: event.source.key,
      historical: event.historical,
      historicalCurrentLabels: event.historicalCurrentLabels,
    };

    const contentHash = createHash("sha256")
      .update(JSON.stringify(canonicalizeForHash(content)))
      .digest("hex");

    const personalOwnerHqUserId = await resolveActivityPersonalOwner(tx, {
      hqUserId: event.actor.personalOwnerHqUserId,
      discordUserId: event.actor.discordUserId,
    });

    const insertedRows = await tx
      .insert(schema.activityEvents)
      .values({ id: nanoid(), ...content, personalOwnerHqUserId, contentHash })
      .onConflictDoNothing({
        target: [
          schema.activityEvents.sourceNamespace,
          schema.activityEvents.sourceKey,
        ],
      })
      .returning({ id: schema.activityEvents.id });

    const insertedRow = insertedRows[0];
    if (insertedRow) {
      logActivityWriteSignal("activity_write_success", {
        eventKey: event.eventKey,
        durationMs: Date.now() - startedAt,
      });
      return { id: insertedRow.id, inserted: true };
    }

    const [existing] = await tx
      .select({
        id: schema.activityEvents.id,
        contentHash: schema.activityEvents.contentHash,
      })
      .from(schema.activityEvents)
      .where(
        and(
          eq(schema.activityEvents.sourceNamespace, event.source.namespace),
          eq(schema.activityEvents.sourceKey, event.source.key),
        ),
      )
      .limit(1);

    if (existing && existing.contentHash === contentHash) {
      logActivityWriteSignal("activity_write_success", {
        eventKey: event.eventKey,
        durationMs: Date.now() - startedAt,
      });
      return { id: existing.id, inserted: false };
    }

    throw new ActivityWriteError({
      eventKey: event.eventKey,
      failureCategory: "idempotency_conflict",
    });
  } catch (error) {
    const failure = toActivityWriteError(error, hintedKey);
    logActivityWriteSignal("activity_write_failure", {
      eventKey: failure.eventKey,
      incidentId: failure.incidentId,
      failureCategory: failure.failureCategory,
      sqlState: failure.sqlState,
      durationMs: Date.now() - startedAt,
    });
    throw failure;
  }
}

export async function withActivityTransaction<T>(
  work: (tx: ActivityTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await getDb().transaction(work);
  } catch (error) {
    if (error instanceof ActivityWriteError) {
      scheduleActivityBlockedAlert(error);
    }
    throw error;
  }
}

export function reportActivityRollback(error: unknown): void {
  if (error instanceof ActivityWriteError) {
    scheduleActivityBlockedAlert(error);
  }
}
