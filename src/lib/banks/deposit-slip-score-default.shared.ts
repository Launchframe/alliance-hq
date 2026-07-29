export const DEPOSIT_SLIP_DEFAULT_CRYSTAL_GOLD_AMOUNT = 6000;

export type DepositSlipScoreDefaultableRow = {
  score: string | null;
  deleted: number | boolean;
  scoreDefaulted?: boolean;
};

function isRowDeleted(row: DepositSlipScoreDefaultableRow): boolean {
  return row.deleted === true || row.deleted === 1;
}

export function applyDepositSlipScoreDefault<
  T extends DepositSlipScoreDefaultableRow,
>(row: T): T & { scoreDefaulted: boolean } {
  if (isRowDeleted(row)) {
    return { ...row, scoreDefaulted: false };
  }
  const trimmed = row.score?.trim() ?? "";
  if (trimmed) {
    return { ...row, scoreDefaulted: false };
  }
  return {
    ...row,
    score: String(DEPOSIT_SLIP_DEFAULT_CRYSTAL_GOLD_AMOUNT),
    scoreDefaulted: true,
  };
}

export function applyDepositSlipScoreDefaults<
  T extends DepositSlipScoreDefaultableRow,
>(rows: readonly T[]): Array<T & { scoreDefaulted: boolean }> {
  return rows.map((row) => applyDepositSlipScoreDefault(row));
}

export function depositSlipScoreDefaultedRowIds(
  rows: ReadonlyArray<DepositSlipScoreDefaultableRow & { id: string }>,
): Set<string> {
  return new Set(
    rows
      .filter((row) => !isRowDeleted(row) && row.scoreDefaulted === true)
      .map((row) => row.id),
  );
}
