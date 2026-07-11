import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  buildDepositFalloffSeries,
  reconstructActualLockedSeries,
  summarizeProjectionVsActual,
} from "@/lib/banks/optimization.shared";
import { loadBanksWithSlips } from "@/lib/banks/repository.server";
import type {
  DepositFalloffScope,
  DepositProjectionCreatePayload,
  FalloffHorizonHours,
  FalloffPoint,
  SerializedDepositProjection,
} from "@/lib/banks/types.shared";
import {
  DEFAULT_FALLOFF_HORIZON_HOURS,
  DEFAULT_FALLOFF_STEP_HOURS,
  DEPOSIT_FALLOFF_SCOPES,
  FALLOFF_HORIZON_HOURS_OPTIONS,
} from "@/lib/banks/types.shared";
import { getDb, schema } from "@/lib/db";

function isFalloffHorizonHours(value: number): value is FalloffHorizonHours {
  return (FALLOFF_HORIZON_HOURS_OPTIONS as readonly number[]).includes(value);
}

function isFalloffPoint(value: unknown): value is FalloffPoint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.hourStartIso === "string" &&
    typeof row.lockedValue === "number" &&
    typeof row.lockedCount === "number" &&
    typeof row.maturingValue === "number"
  );
}

export function parseHorizonHoursParam(
  raw: string | null,
): FalloffHorizonHours {
  if (raw == null || raw === "") return DEFAULT_FALLOFF_HORIZON_HOURS;
  const n = Number(raw);
  return isFalloffHorizonHours(n) ? n : DEFAULT_FALLOFF_HORIZON_HOURS;
}

export function serializeDepositProjection(row: {
  id: string;
  bankId: string | null;
  name: string;
  notes: string | null;
  horizonHours: number;
  stepHours: number;
  pointsJson: unknown;
  createdAt: Date;
  createdByHqUserId: string | null;
}): SerializedDepositProjection {
  const points = Array.isArray(row.pointsJson)
    ? row.pointsJson.filter(isFalloffPoint)
    : [];
  return {
    id: row.id,
    bankId: row.bankId,
    scope: row.bankId ? "bank" : "alliance",
    name: row.name,
    notes: row.notes,
    horizonHours: isFalloffHorizonHours(row.horizonHours)
      ? row.horizonHours
      : DEFAULT_FALLOFF_HORIZON_HOURS,
    stepHours: row.stepHours,
    points,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdByHqUserId,
  };
}

export async function buildLiveDepositFalloff(
  allianceId: string,
  options: {
    bankId?: string | null;
    horizonHours?: FalloffHorizonHours;
    now?: Date;
  } = {},
): Promise<FalloffPoint[]> {
  const banks = await loadBanksWithSlips(allianceId);
  const horizonHours = options.horizonHours ?? DEFAULT_FALLOFF_HORIZON_HOURS;
  const now = options.now ?? new Date();

  if (options.bankId) {
    const bank = banks.find((row) => row.id === options.bankId);
    if (!bank) {
      throw new Error("Bank not found.");
    }
    return buildDepositFalloffSeries(bank.depositSlips, {
      hours: horizonHours,
      now,
    });
  }

  const allSlips = banks.flatMap((bank) => bank.depositSlips);
  return buildDepositFalloffSeries(allSlips, { hours: horizonHours, now });
}

export async function listDepositProjections(
  allianceId: string,
  filters: { bankId?: string | null; scope?: DepositFalloffScope } = {},
): Promise<SerializedDepositProjection[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.bankDepositProjections)
    .where(eq(schema.bankDepositProjections.allianceId, allianceId))
    .orderBy(desc(schema.bankDepositProjections.createdAt));

  return rows
    .map(serializeDepositProjection)
    .filter((projection) => {
      if (filters.scope === "alliance") return projection.bankId == null;
      if (filters.scope === "bank") {
        if (filters.bankId) return projection.bankId === filters.bankId;
        return projection.bankId != null;
      }
      if (filters.bankId) return projection.bankId === filters.bankId;
      return true;
    });
}

export async function createDepositProjection(
  allianceId: string,
  createdByHqUserId: string | null,
  body: DepositProjectionCreatePayload,
): Promise<SerializedDepositProjection> {
  if (
    !body.scope ||
    !(DEPOSIT_FALLOFF_SCOPES as readonly string[]).includes(body.scope)
  ) {
    throw new Error("Invalid scope.");
  }
  if (!body.name?.trim()) {
    throw new Error("Name is required.");
  }
  if (!isFalloffHorizonHours(body.horizonHours)) {
    throw new Error("Invalid horizonHours.");
  }
  if (body.scope === "bank" && !body.bankId) {
    throw new Error("bankId is required for bank-scoped projections.");
  }
  if (body.scope === "alliance" && body.bankId) {
    throw new Error("bankId must be null for alliance-scoped projections.");
  }

  const banks = await loadBanksWithSlips(allianceId);
  const bankId = body.scope === "bank" ? body.bankId : null;
  if (bankId && !banks.some((bank) => bank.id === bankId)) {
    throw new Error("Bank not found.");
  }

  const slips =
    bankId == null
      ? banks.flatMap((bank) => bank.depositSlips)
      : (banks.find((bank) => bank.id === bankId)?.depositSlips ?? []);

  const now = new Date();
  const stepHours = body.stepHours ?? DEFAULT_FALLOFF_STEP_HOURS;
  const points = buildDepositFalloffSeries(slips, {
    hours: body.horizonHours,
    stepHours,
    now,
  });
  const assumptions = {
    slipFingerprint: slips.map((slip) => ({
      id: slip.id,
      amount: slip.amount,
      status: slip.status,
      depositAt: slip.depositAt,
      maturesAt: slip.maturesAt,
      outcomeAt: slip.outcomeAt,
    })),
    depositPolicy:
      bankId == null
        ? null
        : (banks.find((bank) => bank.id === bankId)?.depositPolicy ?? null),
    dropByAt:
      bankId == null
        ? null
        : (banks.find((bank) => bank.id === bankId)?.dropByAt ?? null),
  };

  const [row] = await getDb()
    .insert(schema.bankDepositProjections)
    .values({
      id: nanoid(),
      allianceId,
      bankId,
      name: body.name.trim(),
      notes: body.notes?.trim() || null,
      asOf: now,
      horizonHours: body.horizonHours,
      stepHours,
      createdByHqUserId,
      assumptionsJson: assumptions,
      pointsJson: points,
      createdAt: now,
    })
    .returning();

  return serializeDepositProjection(row!);
}

export async function getDepositProjectionDetail(
  allianceId: string,
  projectionId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.bankDepositProjections)
    .where(
      and(
        eq(schema.bankDepositProjections.id, projectionId),
        eq(schema.bankDepositProjections.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("Projection not found.");
  }

  const projection = serializeDepositProjection(row);
  const banks = await loadBanksWithSlips(allianceId);
  const slips =
    projection.bankId == null
      ? banks.flatMap((bank) => bank.depositSlips)
      : (banks.find((bank) => bank.id === projection.bankId)?.depositSlips ??
        []);

  const from = new Date(projection.points[0]?.hourStartIso ?? row.asOf);
  const lastPoint = projection.points[projection.points.length - 1];
  const to = lastPoint
    ? new Date(lastPoint.hourStartIso)
    : new Date(from.getTime() + projection.horizonHours * 60 * 60 * 1000);

  const actualPoints = reconstructActualLockedSeries(
    slips,
    from,
    to,
    projection.stepHours,
  );
  const deltas = summarizeProjectionVsActual(projection.points, actualPoints);

  return { projection, actualPoints, deltas };
}

export async function deleteDepositProjection(
  allianceId: string,
  projectionId: string,
): Promise<void> {
  const deleted = await getDb()
    .delete(schema.bankDepositProjections)
    .where(
      and(
        eq(schema.bankDepositProjections.id, projectionId),
        eq(schema.bankDepositProjections.allianceId, allianceId),
      ),
    )
    .returning({ id: schema.bankDepositProjections.id });

  if (deleted.length === 0) {
    throw new Error("Projection not found.");
  }
}
