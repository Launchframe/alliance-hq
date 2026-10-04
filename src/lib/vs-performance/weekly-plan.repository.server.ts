import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { AvailabilityTransaction } from "@/lib/time-off/availability.server";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import type {
  VsPlanDay,
  VsPlanDraft,
  VsPushDefaults,
} from "@/lib/vs-performance/weekly-plan.shared";
import {
  DEFAULT_VS_PUSH_REWARDS,
  VsPerformanceError,
  vsPlanDraftSchema,
  vsPushDefaultsSchema,
} from "@/lib/vs-performance/weekly-plan.shared";

export type VsWeekPlanRow = typeof schema.vsWeekPlans.$inferSelect;

export async function loadVsWeekPlan(
  allianceId: string,
  weekStart: string,
  db: ReturnType<typeof getDb> | AvailabilityTransaction = getDb(),
): Promise<VsWeekPlanRow | null> {
  const [row] = await db
    .select()
    .from(schema.vsWeekPlans)
    .where(
      and(
        eq(schema.vsWeekPlans.allianceId, allianceId),
        eq(schema.vsWeekPlans.weekStart, weekStart),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function loadVsWeekPlanForUpdate(
  tx: AvailabilityTransaction,
  allianceId: string,
  weekStart: string,
): Promise<VsWeekPlanRow | null> {
  const [row] = await tx
    .select()
    .from(schema.vsWeekPlans)
    .where(
      and(
        eq(schema.vsWeekPlans.allianceId, allianceId),
        eq(schema.vsWeekPlans.weekStart, weekStart),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export function planDraftFromRow(
  row: VsWeekPlanRow,
): VsPlanDraft & {
  version: number;
  leadDays: number;
  applied: {
    appliedAt: string | null;
    leadDays: number;
    rules: Record<string, ConductorRule | null>;
  } | null;
} {
  const draft = vsPlanDraftSchema.parse({
    weekStart: row.weekStart,
    platform: row.platform,
    days: row.days as VsPlanDay[],
  });
  const applied = row.appliedMeta as {
    appliedAt?: string | null;
    leadDays?: number;
    rules?: Record<string, ConductorRule | null>;
  } | null;
  return {
    ...draft,
    version: row.version,
    leadDays: row.leadDays,
    applied: applied
      ? {
          appliedAt: applied.appliedAt ?? null,
          leadDays: applied.leadDays ?? row.leadDays,
          rules: applied.rules ?? {},
        }
      : null,
  };
}

export async function saveVsWeekPlanRow(
  tx: AvailabilityTransaction,
  input: {
    allianceId: string;
    draft: VsPlanDraft;
    leadDays: number;
    appliedRules: Record<string, ConductorRule | null>;
    expectedVersion: number;
    actorHqUserId: string | null;
  },
): Promise<VsWeekPlanRow> {
  const existing = await loadVsWeekPlanForUpdate(
    tx,
    input.allianceId,
    input.draft.weekStart,
  );
  const previousRules =
    (existing?.appliedMeta as {
      rules?: Record<string, ConductorRule | null>;
    } | null)?.rules ?? {};
  const appliedMeta = {
    appliedAt: new Date().toISOString(),
    leadDays: input.leadDays,
    rules: { ...previousRules, ...input.appliedRules },
  };
  if (existing) {
    if (existing.version !== input.expectedVersion) {
      throw new VsPerformanceError("stale", 409);
    }
    const [row] = await tx
      .update(schema.vsWeekPlans)
      .set({
        platform: input.draft.platform,
        days: input.draft.days,
        leadDays: input.leadDays,
        appliedMeta,
        version: existing.version + 1,
        updatedByHqUserId: input.actorHqUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.vsWeekPlans.id, existing.id),
          eq(schema.vsWeekPlans.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!row) throw new VsPerformanceError("stale", 409);
    return row;
  }
  if (input.expectedVersion !== 0) throw new VsPerformanceError("stale", 409);
  const [row] = await tx
    .insert(schema.vsWeekPlans)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      weekStart: input.draft.weekStart,
      platform: input.draft.platform,
      days: input.draft.days,
      leadDays: input.leadDays,
      appliedMeta,
      createdByHqUserId: input.actorHqUserId,
      updatedByHqUserId: input.actorHqUserId,
    })
    .returning();
  return row!;
}

export async function loadVsStrategyPreferences(
  allianceId: string,
  db: ReturnType<typeof getDb> | AvailabilityTransaction = getDb(),
): Promise<{ version: number; defaults: VsPushDefaults }> {
  const [row] = await db
    .select()
    .from(schema.vsStrategyPreferences)
    .where(eq(schema.vsStrategyPreferences.allianceId, allianceId))
    .limit(1);
  if (!row) return { version: 0, defaults: DEFAULT_VS_PUSH_REWARDS };
  return {
    version: row.version,
    defaults: vsPushDefaultsSchema.parse(row.pushDefaults),
  };
}

export async function saveVsStrategyPreferences(
  allianceId: string,
  input: {
    defaults: VsPushDefaults;
    expectedVersion: number;
    actorHqUserId: string | null;
  },
): Promise<{ version: number; defaults: VsPushDefaults }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.vsStrategyPreferences)
      .where(eq(schema.vsStrategyPreferences.allianceId, allianceId))
      .for("update")
      .limit(1);
    if (existing) {
      if (existing.version !== input.expectedVersion) {
        throw new VsPerformanceError("stale", 409);
      }
      const [row] = await tx
        .update(schema.vsStrategyPreferences)
        .set({
          pushDefaults: input.defaults,
          version: existing.version + 1,
          updatedByHqUserId: input.actorHqUserId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.vsStrategyPreferences.allianceId, allianceId),
            eq(schema.vsStrategyPreferences.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!row) throw new VsPerformanceError("stale", 409);
      return { version: row.version, defaults: input.defaults };
    }
    if (input.expectedVersion !== 0) throw new VsPerformanceError("stale", 409);
    const [row] = await tx
      .insert(schema.vsStrategyPreferences)
      .values({
        allianceId,
        pushDefaults: input.defaults,
        updatedByHqUserId: input.actorHqUserId,
      })
      .returning();
    return { version: row.version, defaults: input.defaults };
  });
}
