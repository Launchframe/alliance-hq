import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  computeMaturesAt,
  serializeBank,
  serializeDepositSlip,
  type BankPayload,
  type DepositSlipPayload,
} from "@/lib/banks/api.shared";
import {
  buildHeatmapsForBanks,
  recommendNextDrop,
} from "@/lib/banks/optimization.shared";
import type {
  BankManagementPayload,
  BankWithSlips,
} from "@/lib/banks/types.shared";
import { getDb, schema } from "@/lib/db";

export async function listBanksForAlliance(allianceId: string) {
  return getDb()
    .select()
    .from(schema.banks)
    .where(eq(schema.banks.allianceId, allianceId))
    .orderBy(asc(schema.banks.level), asc(schema.banks.coordX));
}

export async function listDepositSlipsForAlliance(allianceId: string) {
  return getDb()
    .select()
    .from(schema.bankDepositSlips)
    .where(eq(schema.bankDepositSlips.allianceId, allianceId))
    .orderBy(asc(schema.bankDepositSlips.depositAt));
}

export async function loadBanksWithSlips(
  allianceId: string,
): Promise<BankWithSlips[]> {
  const [banks, slips] = await Promise.all([
    listBanksForAlliance(allianceId),
    listDepositSlipsForAlliance(allianceId),
  ]);

  const slipsByBank = new Map<string, ReturnType<typeof serializeDepositSlip>[]>();
  for (const slip of slips) {
    const serialized = serializeDepositSlip(slip);
    const list = slipsByBank.get(slip.bankId) ?? [];
    list.push(serialized);
    slipsByBank.set(slip.bankId, list);
  }

  return banks.map((bank) => ({
    ...serializeBank(bank),
    depositSlips: slipsByBank.get(bank.id) ?? [],
  }));
}

export function buildBankManagementPayload(
  banks: BankWithSlips[],
  options: {
    canWrite: boolean;
    todayServerDate: string;
    effectiveSeasonKey?: string;
    nextCaptureLevel?: number | null;
    now?: Date;
  },
): BankManagementPayload {
  const nextCaptureLevel = options.nextCaptureLevel ?? null;
  return {
    banks,
    recommendation: recommendNextDrop(banks, {
      nextCaptureLevel,
      now: options.now,
    }),
    heatmaps: buildHeatmapsForBanks(banks, { now: options.now }),
    canWrite: options.canWrite,
    todayServerDate: options.todayServerDate,
    effectiveSeasonKey: options.effectiveSeasonKey,
    nextCaptureLevel,
  };
}

export async function createBank(allianceId: string, body: BankPayload) {
  const db = getDb();
  const inserted = await db
    .insert(schema.banks)
    .values({
      id: nanoid(),
      allianceId,
      gameServerNumber: body.gameServerNumber,
      coordX: body.coordX,
      coordY: body.coordY,
      level: body.level,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : null,
      dropByAt: body.dropByAt ? new Date(body.dropByAt) : null,
      depositPolicy: body.depositPolicy ?? null,
      priorCaptureCount: body.priorCaptureCount ?? 0,
      currentDepositCount: body.currentDepositCount ?? null,
      currentDepositValue: body.currentDepositValue ?? null,
      notes: body.notes?.trim() || null,
    })
    .returning();
  return inserted[0]!;
}

export async function updateBank(
  allianceId: string,
  bankId: string,
  body: BankPayload,
) {
  const db = getDb();
  const updated = await db
    .update(schema.banks)
    .set({
      gameServerNumber: body.gameServerNumber,
      coordX: body.coordX,
      coordY: body.coordY,
      level: body.level,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : null,
      dropByAt: body.dropByAt ? new Date(body.dropByAt) : null,
      depositPolicy: body.depositPolicy ?? null,
      priorCaptureCount: body.priorCaptureCount ?? 0,
      currentDepositCount: body.currentDepositCount ?? null,
      currentDepositValue: body.currentDepositValue ?? null,
      notes: body.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.banks.id, bankId), eq(schema.banks.allianceId, allianceId)),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("Bank not found.");
  }
  return updated[0]!;
}

export async function deleteBank(allianceId: string, bankId: string) {
  const db = getDb();
  const deleted = await db
    .delete(schema.banks)
    .where(
      and(eq(schema.banks.id, bankId), eq(schema.banks.allianceId, allianceId)),
    )
    .returning({ id: schema.banks.id });

  if (deleted.length === 0) {
    throw new Error("Bank not found.");
  }
}

export async function createDepositSlip(
  allianceId: string,
  body: DepositSlipPayload,
) {
  const db = getDb();
  const bank = await db
    .select({ id: schema.banks.id })
    .from(schema.banks)
    .where(
      and(
        eq(schema.banks.id, body.bankId),
        eq(schema.banks.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!bank[0]) {
    throw new Error("Bank not found.");
  }

  const depositAt = new Date(body.depositAt);
  const maturesAt = computeMaturesAt(depositAt, body.termDays);
  const inserted = await db
    .insert(schema.bankDepositSlips)
    .values({
      id: nanoid(),
      allianceId,
      bankId: body.bankId,
      depositAt,
      termDays: body.termDays,
      maturesAt,
      status: body.status ?? "locked",
      outcomeAt: body.outcomeAt ? new Date(body.outcomeAt) : null,
      amount: body.amount,
      depositAllianceTag: body.depositAllianceTag?.trim() || null,
      depositAllianceId: body.depositAllianceId ?? null,
      commanderName: body.commanderName.trim(),
      commanderId: body.commanderId ?? null,
    })
    .returning();
  return inserted[0]!;
}

export async function updateDepositSlip(
  allianceId: string,
  slipId: string,
  body: DepositSlipPayload,
) {
  const db = getDb();
  const bank = await db
    .select({ id: schema.banks.id })
    .from(schema.banks)
    .where(
      and(
        eq(schema.banks.id, body.bankId),
        eq(schema.banks.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!bank[0]) {
    throw new Error("Bank not found.");
  }

  const depositAt = new Date(body.depositAt);
  const maturesAt = computeMaturesAt(depositAt, body.termDays);
  const updated = await db
    .update(schema.bankDepositSlips)
    .set({
      bankId: body.bankId,
      depositAt,
      termDays: body.termDays,
      maturesAt,
      status: body.status ?? "locked",
      outcomeAt: body.outcomeAt ? new Date(body.outcomeAt) : null,
      amount: body.amount,
      depositAllianceTag: body.depositAllianceTag?.trim() || null,
      depositAllianceId: body.depositAllianceId ?? null,
      commanderName: body.commanderName.trim(),
      commanderId: body.commanderId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bankDepositSlips.id, slipId),
        eq(schema.bankDepositSlips.allianceId, allianceId),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("Deposit slip not found.");
  }
  return updated[0]!;
}

export async function deleteDepositSlip(allianceId: string, slipId: string) {
  const db = getDb();
  const deleted = await db
    .delete(schema.bankDepositSlips)
    .where(
      and(
        eq(schema.bankDepositSlips.id, slipId),
        eq(schema.bankDepositSlips.allianceId, allianceId),
      ),
    )
    .returning({ id: schema.bankDepositSlips.id });

  if (deleted.length === 0) {
    throw new Error("Deposit slip not found.");
  }
}
