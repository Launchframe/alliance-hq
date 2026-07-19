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
import { BANK_PROTECTION_DURATION_MS } from "@/lib/banks/types.shared";
import {
  buildHeatmapsForBanks,
  recommendNextDrop,
} from "@/lib/banks/optimization.shared";
import type {
  BankManagementPayload,
  BankWithSlips,
} from "@/lib/banks/types.shared";
import { getDb, schema } from "@/lib/db";

export async function loadAllianceGameServerNumber(
  allianceId: string,
): Promise<number | null> {
  const rows = await getDb()
    .select({ gameServerNumber: schema.alliances.gameServerNumber })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return rows[0]?.gameServerNumber ?? null;
}

export type AllianceBankCityListSnapshot = {
  bankCapturesRemainingToday: number | null;
  bankCapturesLimitToday: number | null;
  bankCityListServerTime: Date | null;
  bankCityListCapturedCount: number | null;
  bankCityListCapturedCap: number | null;
  bankCityListImportedAt: Date | null;
};

export async function loadAllianceBankCityListSnapshot(
  allianceId: string,
): Promise<AllianceBankCityListSnapshot | null> {
  const rows = await getDb()
    .select({
      bankCapturesRemainingToday: schema.alliances.bankCapturesRemainingToday,
      bankCapturesLimitToday: schema.alliances.bankCapturesLimitToday,
      bankCityListServerTime: schema.alliances.bankCityListServerTime,
      bankCityListCapturedCount: schema.alliances.bankCityListCapturedCount,
      bankCityListCapturedCap: schema.alliances.bankCityListCapturedCap,
      bankCityListImportedAt: schema.alliances.bankCityListImportedAt,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return rows[0] ?? null;
}

export type CityListBankUpsertInput = {
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  currentDepositValue: number | null;
  currentDepositCount: number | null;
};

export async function upsertBanksFromCityList(
  allianceId: string,
  banks: CityListBankUpsertInput[],
) {
  const db = getDb();
  const results = [];

  for (const bank of banks) {
    const existing = await db
      .select()
      .from(schema.banks)
      .where(
        and(
          eq(schema.banks.allianceId, allianceId),
          eq(schema.banks.gameServerNumber, bank.gameServerNumber),
          eq(schema.banks.coordX, bank.coordX),
          eq(schema.banks.coordY, bank.coordY),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const updated = await db
        .update(schema.banks)
        .set({
          level: bank.level,
          currentDepositCount: bank.currentDepositCount,
          currentDepositValue: bank.currentDepositValue,
          updatedAt: new Date(),
        })
        .where(eq(schema.banks.id, existing[0].id))
        .returning();
      results.push(updated[0]!);
      continue;
    }

    const inserted = await db
      .insert(schema.banks)
      .values({
        id: nanoid(),
        allianceId,
        gameServerNumber: bank.gameServerNumber,
        coordX: bank.coordX,
        coordY: bank.coordY,
        level: bank.level,
        depositPolicy: null,
        // City List only shows banks we already hold.
        priorCaptureCount: 1,
        currentDepositCount: bank.currentDepositCount,
        currentDepositValue: bank.currentDepositValue,
      })
      .returning();
    results.push(inserted[0]!);
  }

  return results;
}

export async function updateAllianceBankCityListSnapshot(
  allianceId: string,
  snapshot: {
    bankCapturesRemainingToday: number | null;
    bankCapturesLimitToday: number | null;
    bankCityListServerTime: Date | null;
    bankCityListCapturedCount: number | null;
    bankCityListCapturedCap: number | null;
  },
) {
  const db = getDb();
  const updated = await db
    .update(schema.alliances)
    .set({
      bankCapturesRemainingToday: snapshot.bankCapturesRemainingToday,
      bankCapturesLimitToday: snapshot.bankCapturesLimitToday,
      bankCityListServerTime: snapshot.bankCityListServerTime,
      bankCityListCapturedCount: snapshot.bankCityListCapturedCount,
      bankCityListCapturedCap: snapshot.bankCityListCapturedCap,
      bankCityListImportedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId))
    .returning({ id: schema.alliances.id });

  if (updated.length === 0) {
    throw new Error("Alliance not found.");
  }
}

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

export async function listDepositSlipsForBank(
  allianceId: string,
  bankId: string,
) {
  return getDb()
    .select()
    .from(schema.bankDepositSlips)
    .where(
      and(
        eq(schema.bankDepositSlips.allianceId, allianceId),
        eq(schema.bankDepositSlips.bankId, bankId),
      ),
    )
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
    allianceId: string;
    canWrite: boolean;
    todayServerDate: string;
    effectiveSeasonKey?: string;
    nextCaptureLevel?: number | null;
    allianceGameServerNumber?: number | null;
    bankCapturesRemainingToday?: number | null;
    bankCapturesLimitToday?: number | null;
    bankCityListServerTime?: string | null;
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
    allianceId: options.allianceId,
    effectiveSeasonKey: options.effectiveSeasonKey,
    nextCaptureLevel,
    allianceGameServerNumber: options.allianceGameServerNumber ?? null,
    bankCapturesRemainingToday: options.bankCapturesRemainingToday ?? null,
    bankCapturesLimitToday: options.bankCapturesLimitToday ?? null,
    bankCityListServerTime: options.bankCityListServerTime ?? null,
  };
}

function resolveProtectionExpiresAt(
  explicit: string | null | undefined,
  capturedAt: Date | null,
): Date | null {
  if (explicit) return new Date(explicit);
  if (capturedAt) {
    return new Date(capturedAt.getTime() + BANK_PROTECTION_DURATION_MS);
  }
  return null;
}

export async function createBank(allianceId: string, body: BankPayload) {
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : null;
  const protectionExpiresAt = resolveProtectionExpiresAt(
    body.protectionExpiresAt,
    capturedAt,
  );
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
      capturedAt,
      protectionExpiresAt,
      dropByAt: body.dropByAt ? new Date(body.dropByAt) : null,
      depositPolicy: body.depositPolicy,
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
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : null;
  const protectionExpiresAt = resolveProtectionExpiresAt(
    body.protectionExpiresAt,
    capturedAt,
  );
  const db = getDb();
  const updated = await db
    .update(schema.banks)
    .set({
      gameServerNumber: body.gameServerNumber,
      coordX: body.coordX,
      coordY: body.coordY,
      level: body.level,
      capturedAt,
      protectionExpiresAt,
      dropByAt: body.dropByAt ? new Date(body.dropByAt) : null,
      depositPolicy: body.depositPolicy,
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
      outcomeAmount: body.outcomeAmount ?? null,
      depositAllianceTag: body.depositAllianceTag?.trim() || null,
      depositAllianceId: body.depositAllianceId ?? null,
      commanderName: body.commanderName.trim(),
      commanderId: body.commanderId ?? null,
      allianceMemberId: body.allianceMemberId ?? null,
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
      outcomeAmount: body.outcomeAmount ?? null,
      depositAllianceTag: body.depositAllianceTag?.trim() || null,
      depositAllianceId: body.depositAllianceId ?? null,
      commanderName: body.commanderName.trim(),
      commanderId: body.commanderId ?? null,
      allianceMemberId: body.allianceMemberId ?? null,
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
