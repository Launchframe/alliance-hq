import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { CaptureEventPayload } from "@/lib/battle-plan/api.shared";
import {
  isTerritoryType,
  serializeBattlePlanMarker,
  serializeBattlePlanSettings,
  serializeCaptureEvent,
} from "@/lib/battle-plan/api.shared";
import type { CaptureEventLimitRow } from "@/lib/battle-plan/server-day-limits.shared";
import { validateServerDayCaptureLimit } from "@/lib/battle-plan/server-day-limits.shared";
import { BATTLE_PLAN_MARKER_NUMBERS } from "@/lib/battle-plan/types.shared";
import { formatServerCalendarDate } from "@/lib/trains/game-time";
import { getDb, schema } from "@/lib/db";

export class BattlePlanRevisionConflictError extends Error {
  readonly code = "revision_conflict" as const;

  constructor() {
    super("Battle plan was updated by another officer.");
    this.name = "BattlePlanRevisionConflictError";
  }
}

async function ensureBattlePlanSettings(allianceId: string) {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.battlePlanSettings)
    .where(eq(schema.battlePlanSettings.allianceId, allianceId))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const inserted = await db
    .insert(schema.battlePlanSettings)
    .values({ allianceId })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return inserted[0];
  }

  const fallback = await db
    .select()
    .from(schema.battlePlanSettings)
    .where(eq(schema.battlePlanSettings.allianceId, allianceId))
    .limit(1);
  return fallback[0]!;
}

async function ensureBattlePlanMarkers(allianceId: string) {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.battlePlanMarkers)
    .where(eq(schema.battlePlanMarkers.allianceId, allianceId))
    .orderBy(asc(schema.battlePlanMarkers.markerNumber));

  if (existing.length >= BATTLE_PLAN_MARKER_NUMBERS.length) {
    return existing;
  }

  const existingNumbers = new Set(existing.map((row) => row.markerNumber));
  const missing = BATTLE_PLAN_MARKER_NUMBERS.filter(
    (markerNumber) => !existingNumbers.has(markerNumber),
  );

  if (missing.length > 0) {
    await db.insert(schema.battlePlanMarkers).values(
      missing.map((markerNumber) => ({
        id: nanoid(),
        allianceId,
        markerNumber,
      })),
    );
  }

  return db
    .select()
    .from(schema.battlePlanMarkers)
    .where(eq(schema.battlePlanMarkers.allianceId, allianceId))
    .orderBy(asc(schema.battlePlanMarkers.markerNumber));
}

export async function loadBattlePlanRows(allianceId: string) {
  const [settings, markers, events] = await Promise.all([
    ensureBattlePlanSettings(allianceId),
    ensureBattlePlanMarkers(allianceId),
    getDb()
      .select()
      .from(schema.battlePlanCaptureEvents)
      .where(eq(schema.battlePlanCaptureEvents.allianceId, allianceId))
      .orderBy(asc(schema.battlePlanCaptureEvents.scheduledAt)),
  ]);

  return { settings, markers, events };
}

export async function bumpBattlePlanRevision(
  allianceId: string,
  expectedRevision: number,
) {
  const db = getDb();
  const updated = await db
    .update(schema.battlePlanSettings)
    .set({
      planRevision: expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.battlePlanSettings.allianceId, allianceId),
        eq(schema.battlePlanSettings.planRevision, expectedRevision),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new BattlePlanRevisionConflictError();
  }

  return updated[0]!;
}

export async function updateBattlePlanSettings(
  allianceId: string,
  input: {
    planRevision: number;
    defaultCapturePolicy?: string;
    discordReportsEnabled?: boolean;
  },
) {
  await bumpBattlePlanRevision(allianceId, input.planRevision);
  const db = getDb();
  const patch: {
    defaultCapturePolicy?: string;
    discordReportsEnabled?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (input.defaultCapturePolicy !== undefined) {
    patch.defaultCapturePolicy = input.defaultCapturePolicy;
  }
  if (input.discordReportsEnabled !== undefined) {
    patch.discordReportsEnabled = input.discordReportsEnabled ? 1 : 0;
  }
  const updated = await db
    .update(schema.battlePlanSettings)
    .set(patch)
    .where(eq(schema.battlePlanSettings.allianceId, allianceId))
    .returning();

  return updated[0]!;
}

export async function updateBattlePlanMarker(
  allianceId: string,
  markerNumber: number,
  input: { planRevision: number; label?: string | null },
) {
  await bumpBattlePlanRevision(allianceId, input.planRevision);
  const db = getDb();
  const updated = await db
    .update(schema.battlePlanMarkers)
    .set({
      label: input.label?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.battlePlanMarkers.allianceId, allianceId),
        eq(schema.battlePlanMarkers.markerNumber, markerNumber),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("Marker not found.");
  }

  return updated[0]!;
}

async function listLimitRows(allianceId: string): Promise<CaptureEventLimitRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.battlePlanCaptureEvents.id,
      serverCalendarDate: schema.battlePlanCaptureEvents.serverCalendarDate,
      territoryType: schema.battlePlanCaptureEvents.territoryType,
      status: schema.battlePlanCaptureEvents.status,
    })
    .from(schema.battlePlanCaptureEvents)
    .where(eq(schema.battlePlanCaptureEvents.allianceId, allianceId));

  return rows.flatMap((row) =>
    isTerritoryType(row.territoryType)
      ? [
          {
            id: row.id,
            serverCalendarDate: row.serverCalendarDate,
            territoryType: row.territoryType,
            status: row.status,
          },
        ]
      : [],
  );
}

export async function createCaptureEvent(
  allianceId: string,
  createdByHqUserId: string | null,
  body: CaptureEventPayload & { planRevision: number },
) {
  const scheduledAt = new Date(body.scheduledAt);
  const serverCalendarDate = formatServerCalendarDate(scheduledAt);
  const limitRows = await listLimitRows(allianceId);
  const limitError = validateServerDayCaptureLimit({
    events: limitRows,
    serverCalendarDate,
    territoryType: body.territoryType,
  });
  if (limitError) {
    throw new Error(limitError);
  }

  await bumpBattlePlanRevision(allianceId, body.planRevision);

  const db = getDb();
  const inserted = await db
    .insert(schema.battlePlanCaptureEvents)
    .values({
      id: nanoid(),
      allianceId,
      scheduledAt,
      serverCalendarDate,
      territoryType: body.territoryType,
      markerNumber: body.markerNumber,
      capturePolicy: body.capturePolicy ?? null,
      notes: body.notes?.trim() || null,
      status: body.status ?? "scheduled",
      createdByHqUserId,
    })
    .returning();

  return inserted[0]!;
}

export async function updateCaptureEvent(
  allianceId: string,
  eventId: string,
  body: CaptureEventPayload & { planRevision: number },
) {
  const scheduledAt = new Date(body.scheduledAt);
  const serverCalendarDate = formatServerCalendarDate(scheduledAt);
  const limitRows = await listLimitRows(allianceId);
  const limitError = validateServerDayCaptureLimit({
    events: limitRows,
    serverCalendarDate,
    territoryType: body.territoryType,
    excludeEventId: eventId,
  });
  if (limitError && (body.status ?? "scheduled") === "scheduled") {
    throw new Error(limitError);
  }

  await bumpBattlePlanRevision(allianceId, body.planRevision);

  const db = getDb();
  const updated = await db
    .update(schema.battlePlanCaptureEvents)
    .set({
      scheduledAt,
      serverCalendarDate,
      territoryType: body.territoryType,
      markerNumber: body.markerNumber,
      capturePolicy: body.capturePolicy ?? null,
      notes: body.notes?.trim() || null,
      status: body.status ?? "scheduled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.battlePlanCaptureEvents.id, eventId),
        eq(schema.battlePlanCaptureEvents.allianceId, allianceId),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("Capture event not found.");
  }

  return updated[0]!;
}

export async function deleteCaptureEvent(
  allianceId: string,
  eventId: string,
  planRevision: number,
) {
  await bumpBattlePlanRevision(allianceId, planRevision);

  const db = getDb();
  const deleted = await db
    .delete(schema.battlePlanCaptureEvents)
    .where(
      and(
        eq(schema.battlePlanCaptureEvents.id, eventId),
        eq(schema.battlePlanCaptureEvents.allianceId, allianceId),
      ),
    )
    .returning({ id: schema.battlePlanCaptureEvents.id });

  if (deleted.length === 0) {
    throw new Error("Capture event not found.");
  }
}

export function serializeBattlePlanDashboard(
  rows: Awaited<ReturnType<typeof loadBattlePlanRows>>,
  options: { canWrite: boolean; todayServerDate: string },
) {
  const settings = serializeBattlePlanSettings(rows.settings);
  return {
    settings,
    markers: rows.markers.map(serializeBattlePlanMarker),
    events: rows.events.map((event) =>
      serializeCaptureEvent(event, settings.defaultCapturePolicy),
    ),
    canWrite: options.canWrite,
    todayServerDate: options.todayServerDate,
  };
}

export async function reloadSerializedDashboard(
  allianceId: string,
  canWrite: boolean,
  todayServerDate: string,
) {
  const rows = await loadBattlePlanRows(allianceId);
  return serializeBattlePlanDashboard(rows, { canWrite, todayServerDate });
}
