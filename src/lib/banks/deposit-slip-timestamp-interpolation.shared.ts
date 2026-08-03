export function isValidDepositSlipReviewTimestamp(
  iso: string | null | undefined,
): boolean {
  const trimmed = iso?.trim();
  if (!trimmed) return false;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms);
}

export type DepositSlipTimestampInterpolatableRow = {
  id: string;
  powerLevel?: string | null;
  frameIndex?: number | null;
};

/**
 * Fill missing deposit-at timestamps by linear interpolation in frame order
 * between the nearest valid timestamps on each side.
 */
export function interpolateMissingDepositSlipTimestamps<
  T extends DepositSlipTimestampInterpolatableRow,
>(
  rows: readonly T[],
  options: { enabled: boolean },
): Array<T & { depositAtInterpolated: boolean }> {
  if (!options.enabled) {
    return rows.map((row) => ({
      ...row,
      depositAtInterpolated: false,
    }));
  }

  const indexed = rows.map((row, idx) => ({
    row,
    idx,
    frame: row.frameIndex ?? Number.MAX_SAFE_INTEGER,
  }));
  const order = [...indexed].sort(
    (a, b) => a.frame - b.frame || a.idx - b.idx,
  );

  const result = rows.map((row) => ({
    ...row,
    depositAtInterpolated: false,
  }));

  const validMsByOrderIndex = order.map(({ row }) =>
    isValidDepositSlipReviewTimestamp(row.powerLevel ?? null)
      ? Date.parse(row.powerLevel!.trim())
      : null,
  );

  let oi = 0;
  while (oi < order.length) {
    if (validMsByOrderIndex[oi] != null) {
      oi += 1;
      continue;
    }

    let prevOi = oi - 1;
    while (prevOi >= 0 && validMsByOrderIndex[prevOi] == null) {
      prevOi -= 1;
    }
    let nextOi = oi + 1;
    while (nextOi < order.length && validMsByOrderIndex[nextOi] == null) {
      nextOi += 1;
    }

    if (prevOi < 0 || nextOi >= order.length) {
      oi += 1;
      continue;
    }

    const prevFrame = order[prevOi]!.frame;
    const nextFrame = order[nextOi]!.frame;
    const prevMs = validMsByOrderIndex[prevOi]!;
    const nextMs = validMsByOrderIndex[nextOi]!;
    const gapCount = nextOi - prevOi - 1;

    for (let k = prevOi + 1; k < nextOi; k++) {
      const positionInGap = k - prevOi;
      const frame = order[k]!.frame;
      const t =
        nextFrame === prevFrame
          ? positionInGap / (gapCount + 1)
          : (frame - prevFrame) / (nextFrame - prevFrame);
      const ms = Math.round(prevMs + t * (nextMs - prevMs));
      const originalIdx = order[k]!.idx;
      result[originalIdx] = {
        ...result[originalIdx]!,
        powerLevel: new Date(ms).toISOString(),
        depositAtInterpolated: true,
      };
    }

    oi = nextOi + 1;
  }

  return result;
}
