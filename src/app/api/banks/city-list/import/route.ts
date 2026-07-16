/**
 * POST /api/banks/city-list/import
 *
 * Commit a reviewed City List parse: upsert banks by alliance+server+coords
 * and persist alliance captures-left / server-time snapshot fields.
 */

import { NextResponse } from "next/server";

import { cityListImportBankIdentityError } from "@/lib/banks/city-list-import-review.shared";
import { reloadBankManagementDashboard } from "@/lib/banks/reload-dashboard.server";
import {
  listBanksForAlliance,
  updateAllianceBankCityListSnapshot,
  upsertBanksFromCityList,
  type CityListBankUpsertInput,
} from "@/lib/banks/repository.server";
import {
  requireBankAllianceContext,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";

export const dynamic = "force-dynamic";

type ImportCityListBody = {
  banks?: Array<{
    gameServerNumber?: unknown;
    coordX?: unknown;
    coordY?: unknown;
    level?: unknown;
    currentDepositValue?: unknown;
    currentDepositCount?: unknown;
  }>;
  capturedCount?: number | null;
  capturedLimit?: number | null;
  capturesRemainingToday?: number | null;
  capturesLimitToday?: number | null;
  serverTime?: string | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asNullableInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null) return null;
  return Math.trunc(n);
}

function bankKey(server: number, x: number, y: number): string {
  return `${server}:${x}:${y}`;
}

function parseImportBanks(
  raw: ImportCityListBody["banks"],
): { banks: CityListBankUpsertInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "banks must be a non-empty array." };
  }

  const banks: CityListBankUpsertInput[] = [];
  const seenKeys = new Set<string>();
  for (const row of raw) {
    const gameServerNumber = asNullableInt(row.gameServerNumber);
    const coordX = asNullableInt(row.coordX);
    const coordY = asNullableInt(row.coordY);
    const level = asNullableInt(row.level);
    if (
      gameServerNumber == null ||
      coordX == null ||
      coordY == null ||
      level == null ||
      level < 1
    ) {
      return {
        error:
          "Each bank requires gameServerNumber, coordX, coordY, and level ≥ 1.",
      };
    }

    const identityError = cityListImportBankIdentityError(
      gameServerNumber,
      coordX,
      coordY,
    );
    if (identityError) {
      return { error: identityError };
    }

    const key = bankKey(gameServerNumber, coordX, coordY);
    if (seenKeys.has(key)) {
      return { error: "Duplicate bank coordinates in import payload." };
    }
    seenKeys.add(key);

    const currentDepositValue =
      row.currentDepositValue === null || row.currentDepositValue === undefined
        ? null
        : asFiniteNumber(row.currentDepositValue);
    if (
      row.currentDepositValue != null &&
      row.currentDepositValue !== undefined &&
      currentDepositValue == null
    ) {
      return { error: "currentDepositValue must be a number or null." };
    }

    const currentDepositCount =
      row.currentDepositCount === null || row.currentDepositCount === undefined
        ? null
        : asNullableInt(row.currentDepositCount);
    if (
      row.currentDepositCount != null &&
      row.currentDepositCount !== undefined &&
      currentDepositCount == null
    ) {
      return { error: "currentDepositCount must be an integer or null." };
    }

    banks.push({
      gameServerNumber,
      coordX,
      coordY,
      level,
      currentDepositValue,
      currentDepositCount,
    });
  }

  return { banks };
}

export async function POST(request: Request) {
  const context = await requireBankAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBankWrite(sessionId);
  if (denied) return denied;

  let body: ImportCityListBody;
  try {
    body = (await request.json()) as ImportCityListBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseImportBanks(body.banks);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const capturedCount =
    body.capturedCount === undefined
      ? null
      : body.capturedCount == null
        ? null
        : asNullableInt(body.capturedCount);
  const capturedLimit =
    body.capturedLimit === undefined
      ? null
      : body.capturedLimit == null
        ? null
        : asNullableInt(body.capturedLimit);
  const capturesRemainingToday =
    body.capturesRemainingToday === undefined
      ? null
      : body.capturesRemainingToday == null
        ? null
        : asNullableInt(body.capturesRemainingToday);
  const capturesLimitToday =
    body.capturesLimitToday === undefined
      ? null
      : body.capturesLimitToday == null
        ? null
        : asNullableInt(body.capturesLimitToday);

  let serverTime: Date | null = null;
  if (typeof body.serverTime === "string" && body.serverTime.trim()) {
    const ms = Date.parse(body.serverTime);
    if (Number.isNaN(ms)) {
      return NextResponse.json(
        { error: "serverTime must be a valid ISO timestamp." },
        { status: 400 },
      );
    }
    serverTime = new Date(ms);
  }

  const isComplete =
    capturedCount != null && parsed.banks.length === capturedCount;

  try {
    const existingBanks = await listBanksForAlliance(allianceId);
    await upsertBanksFromCityList(allianceId, parsed.banks);
    await updateAllianceBankCityListSnapshot(allianceId, {
      bankCapturesRemainingToday: capturesRemainingToday,
      bankCapturesLimitToday: capturesLimitToday,
      bankCityListServerTime: serverTime,
      bankCityListCapturedCount: capturedCount,
      bankCityListCapturedCap: capturedLimit,
    });

    const warnings: string[] = [];
    if (isComplete) {
      const importedKeys = new Set(
        parsed.banks.map((bank) =>
          bankKey(bank.gameServerNumber, bank.coordX, bank.coordY),
        ),
      );
      const extraHq = existingBanks.filter(
        (bank) =>
          !importedKeys.has(
            bankKey(bank.gameServerNumber, bank.coordX, bank.coordY),
          ),
      );
      if (extraHq.length > 0) {
        warnings.push(
          "HQ has banks not shown in this screenshot. They were left unchanged.",
        );
      }
    }

    const dashboard = await reloadBankManagementDashboard(
      allianceId,
      sessionId,
    );
    return NextResponse.json({
      dashboard,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
