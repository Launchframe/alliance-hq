import { and, asc, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { CaptureEventPayload } from "@/lib/battle-plan/api.shared";
import {
  isTerritoryType,
  serializeBattlePlanSettings,
  serializeCaptureEvent,
} from "@/lib/battle-plan/api.shared";
import type { CaptureEventLimitRow } from "@/lib/battle-plan/server-day-limits.shared";
import { validateServerDayCaptureLimit } from "@/lib/battle-plan/server-day-limits.shared";
import { formatServerCalendarDate } from "@/lib/trains/game-time";
import { getDb, schema } from "@/lib/db";

type BattlePlanExecutor = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "delete"
>;

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

export async function loadBattlePlanRows(allianceId: string) {
  const [settings, events] = await Promise.all([
    ensureBattlePlanSettings(allianceId),
    getDb()
      .select()
      .from(schema.battlePlanCaptureEvents)
      .where(eq(schema.battlePlanCaptureEvents.allianceId, allianceId))
      .orderBy(asc(schema.battlePlanCaptureEvents.scheduledAt)),
  ]);

  return { settings, events };
}

async function bumpBattlePlanRevisionWith(
  db: BattlePlanExecutor,
  allianceId: string,
  expectedRevision: number,
) {
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

export async function bumpBattlePlanRevision(
  allianceId: string,
  expectedRevision: number,
) {
  return bumpBattlePlanRevisionWith(getDb(), allianceId, expectedRevision);
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

async function listLimitRowsWith(
  db: BattlePlanExecutor,
  allianceId: string,
): Promise<CaptureEventLimitRow[]> {
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

async function releaseIconPresetFromOtherEvents(
  tx: BattlePlanExecutor,
  allianceId: string,
  iconPreset: string | null | undefined,
  excludeEventId?: string,
) {
  if (!iconPreset) {
    return;
  }

  const conditions = [
    eq(schema.battlePlanCaptureEvents.allianceId, allianceId),
    eq(schema.battlePlanCaptureEvents.iconPreset, iconPreset),
    eq(schema.battlePlanCaptureEvents.status, "scheduled"),
  ];
  if (excludeEventId) {
    conditions.push(ne(schema.battlePlanCaptureEvents.id, excludeEventId));
  }

  await tx
    .update(schema.battlePlanCaptureEvents)
    .set({ iconPreset: null, updatedAt: new Date() })
    .where(and(...conditions));
}

export async function createCaptureEvent(
  allianceId: string,
  createdByHqUserId: string | null,
  body: CaptureEventPayload & { planRevision: number },
) {
  const scheduledAt = new Date(body.scheduledAt);
  const serverCalendarDate = formatServerCalendarDate(scheduledAt);
  const iconPreset = body.iconPreset ?? null;
  const db = getDb();

  return db.transaction(async (tx) => {
    await bumpBattlePlanRevisionWith(tx, allianceId, body.planRevision);

    const limitRows = await listLimitRowsWith(tx, allianceId);
    const limitError = validateServerDayCaptureLimit({
      events: limitRows,
      serverCalendarDate,
      territoryType: body.territoryType,
    });
    if (limitError) {
      throw new Error(limitError);
    }

    await releaseIconPresetFromOtherEvents(tx, allianceId, iconPreset);

    const inserted = await tx
      .insert(schema.battlePlanCaptureEvents)
      .values({
        id: nanoid(),
        allianceId,
        scheduledAt,
        serverCalendarDate,
        territoryType: body.territoryType,
        iconPreset,
        capturePolicy: body.capturePolicy ?? null,
        notes: body.notes?.trim() || null,
        status: body.status ?? "scheduled",
        createdByHqUserId,
      })
      .returning();

    return inserted[0]!;
  });
}

export async function updateCaptureEvent(
  allianceId: string,
  eventId: string,
  body: CaptureEventPayload & { planRevision: number },
) {
  const scheduledAt = new Date(body.scheduledAt);
  const serverCalendarDate = formatServerCalendarDate(scheduledAt);
  const iconPreset = body.iconPreset ?? null;
  const db = getDb();

  return db.transaction(async (tx) => {
    await bumpBattlePlanRevisionWith(tx, allianceId, body.planRevision);

    const limitRows = await listLimitRowsWith(tx, allianceId);
    const limitError = validateServerDayCaptureLimit({
      events: limitRows,
      serverCalendarDate,
      territoryType: body.territoryType,
      excludeEventId: eventId,
    });
    if (limitError && (body.status ?? "scheduled") === "scheduled") {
      throw new Error(limitError);
    }

    await releaseIconPresetFromOtherEvents(
      tx,
      allianceId,
      iconPreset,
      eventId,
    );

    const updated = await tx
      .update(schema.battlePlanCaptureEvents)
      .set({
        scheduledAt,
        serverCalendarDate,
        territoryType: body.territoryType,
        iconPreset,
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
  });
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
