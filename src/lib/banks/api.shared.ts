import {
  DEPOSIT_POLICIES,
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type DepositPolicy,
  type DepositStatus,
  type DepositTermDays,
  type SerializedBank,
  type SerializedDepositSlip,
} from "@/lib/banks/types.shared";

export type BankPayload = {
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  capturedAt?: string | null;
  protectionExpiresAt?: string | null;
  dropByAt?: string | null;
  depositPolicy: DepositPolicy;
  priorCaptureCount?: number;
  currentDepositCount?: number | null;
  currentDepositValue?: number | null;
  notes?: string | null;
};

export type DepositSlipPayload = {
  bankId: string;
  depositAt: string;
  termDays: DepositTermDays;
  amount: number;
  outcomeAmount?: number | null;
  status?: DepositStatus;
  outcomeAt?: string | null;
  depositAllianceTag?: string | null;
  depositAllianceId?: string | null;
  commanderName: string;
  commanderId?: string | null;
  allianceMemberId?: string | null;
};

export function isDepositPolicy(value: string): value is DepositPolicy {
  return (DEPOSIT_POLICIES as readonly string[]).includes(value);
}

export function isDepositStatus(value: string): value is DepositStatus {
  return (DEPOSIT_STATUSES as readonly string[]).includes(value);
}

export function isDepositTermDays(value: number): value is DepositTermDays {
  return (DEPOSIT_TERMS as readonly number[]).includes(value);
}

export function computeMaturesAt(depositAt: Date, termDays: number): Date {
  return new Date(depositAt.getTime() + termDays * 24 * 60 * 60 * 1000);
}

export function serializeBank(row: {
  id: string;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  capturedAt: Date | null;
  protectionExpiresAt?: Date | null;
  dropByAt: Date | null;
  depositPolicy: string | null;
  priorCaptureCount: number;
  currentDepositCount: number | null;
  currentDepositValue: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SerializedBank {
  return {
    id: row.id,
    gameServerNumber: row.gameServerNumber,
    coordX: row.coordX,
    coordY: row.coordY,
    level: row.level,
    capturedAt: row.capturedAt?.toISOString() ?? null,
    protectionExpiresAt: row.protectionExpiresAt?.toISOString() ?? null,
    dropByAt: row.dropByAt?.toISOString() ?? null,
    depositPolicy:
      row.depositPolicy && isDepositPolicy(row.depositPolicy)
        ? row.depositPolicy
        : null,
    priorCaptureCount: row.priorCaptureCount,
    currentDepositCount: row.currentDepositCount,
    currentDepositValue: row.currentDepositValue,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeDepositSlip(row: {
  id: string;
  bankId: string;
  depositAt: Date;
  termDays: number;
  maturesAt: Date;
  status: string;
  outcomeAt: Date | null;
  amount: number;
  outcomeAmount: number | null;
  depositAllianceTag: string | null;
  depositAllianceId: string | null;
  commanderName: string;
  commanderId: string | null;
  allianceMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SerializedDepositSlip {
  const termDays = isDepositTermDays(row.termDays) ? row.termDays : 1;
  return {
    id: row.id,
    bankId: row.bankId,
    depositAt: row.depositAt.toISOString(),
    termDays,
    maturesAt: row.maturesAt.toISOString(),
    status: isDepositStatus(row.status) ? row.status : "locked",
    outcomeAt: row.outcomeAt?.toISOString() ?? null,
    amount: row.amount,
    outcomeAmount: row.outcomeAmount ?? null,
    depositAllianceTag: row.depositAllianceTag,
    depositAllianceId: row.depositAllianceId,
    commanderName: row.commanderName,
    commanderId: row.commanderId,
    allianceMemberId: row.allianceMemberId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function validateBankPayload(body: BankPayload): string | null {
  if (
    typeof body.gameServerNumber !== "number" ||
    !Number.isInteger(body.gameServerNumber) ||
    body.gameServerNumber <= 0
  ) {
    return "gameServerNumber must be a positive integer.";
  }
  if (typeof body.coordX !== "number" || !Number.isInteger(body.coordX)) {
    return "coordX must be an integer.";
  }
  if (typeof body.coordY !== "number" || !Number.isInteger(body.coordY)) {
    return "coordY must be an integer.";
  }
  if (
    typeof body.level !== "number" ||
    !Number.isInteger(body.level) ||
    body.level < 1
  ) {
    return "level must be a positive integer.";
  }
  if (!body.depositPolicy || !isDepositPolicy(body.depositPolicy)) {
    return "depositPolicy must be alliance, warzone, or public.";
  }
  if (body.capturedAt != null && body.capturedAt !== "") {
    if (Number.isNaN(new Date(body.capturedAt).getTime())) {
      return "capturedAt must be a valid ISO timestamp.";
    }
  }
  if (body.dropByAt != null && body.dropByAt !== "") {
    if (Number.isNaN(new Date(body.dropByAt).getTime())) {
      return "dropByAt must be a valid ISO timestamp.";
    }
  }
  return null;
}

export function validateDepositSlipPayload(
  body: DepositSlipPayload,
): string | null {
  if (!body.bankId?.trim()) {
    return "bankId is required.";
  }
  if (!body.depositAt?.trim() || Number.isNaN(new Date(body.depositAt).getTime())) {
    return "depositAt must be a valid ISO timestamp.";
  }
  if (!isDepositTermDays(body.termDays)) {
    return "termDays must be 1, 3, or 5.";
  }
  if (
    typeof body.amount !== "number" ||
    !Number.isInteger(body.amount) ||
    body.amount <= 0
  ) {
    return "amount must be a positive integer.";
  }
  if (
    body.outcomeAmount != null &&
    (typeof body.outcomeAmount !== "number" ||
      !Number.isInteger(body.outcomeAmount) ||
      body.outcomeAmount < 0)
  ) {
    return "outcomeAmount must be a non-negative integer.";
  }
  if (!body.commanderName?.trim()) {
    return "commanderName is required.";
  }
  if (body.status != null && !isDepositStatus(body.status)) {
    return "status must be locked, matured, or looted.";
  }
  if (body.outcomeAt != null && body.outcomeAt !== "") {
    if (Number.isNaN(new Date(body.outcomeAt).getTime())) {
      return "outcomeAt must be a valid ISO timestamp.";
    }
  }
  return null;
}
