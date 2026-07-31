/**
 * Deposit Slip History OCR is native Tesseract at concurrency 1. Long dense
 * extracts (hundreds of frames) exceed the video-process maxDuration (~300s).
 * Process frames in chunks and requeue the same job until every frame has OCR,
 * then finalize a single parse session for review.
 */

export const DEPOSIT_SLIP_OCR_CHUNK_STATE_KEY = "depositSlipOcrChunk" as const;

/** Default frames per worker invocation (tune vs maxDuration + extract overhead). */
export const DEFAULT_DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE = 25;

export type DepositSlipOcrChunkState = {
  version: 1;
  /** First frame index not yet OCR'd (0-based, contiguous). */
  nextFrameOffset: number;
  totalFrames: number;
  chunkSize: number;
  /**
   * When set, a worker owns OCR for `nextFrameOffset`. Cleared when the chunk
   * finishes so the next invocation can claim the following window.
   */
  claimToken?: string | null;
  /** ISO timestamp when `claimToken` was issued; stale leases may be reclaimed. */
  claimIssuedAt?: string | null;
};

/** Keep in sync with {@link VIDEO_IN_FLIGHT_STALE_MS} in fail-stale-in-flight-video-jobs.server.ts */
export const DEPOSIT_SLIP_OCR_CHUNK_CLAIM_STALE_MS = 6 * 60 * 1000;

export type DepositSlipOcrChunkClaimLeaseFields = Pick<
  DepositSlipOcrChunkState,
  "nextFrameOffset" | "claimToken" | "claimIssuedAt"
>;

/** Whether compare-and-swap may claim `expectedOffset` (mirrors SQL in chunk-claim.server). */
export function isDepositSlipOcrChunkClaimCasEligible(params: {
  chunk: DepositSlipOcrChunkClaimLeaseFields | null;
  expectedOffset: number;
  nowMs: number;
  staleAfterMs?: number;
}): boolean {
  if (params.chunk == null) {
    return true;
  }
  if (params.chunk.nextFrameOffset !== params.expectedOffset) {
    return false;
  }
  const claimToken = params.chunk.claimToken ?? "";
  if (claimToken === "") {
    return true;
  }
  const issuedAt = params.chunk.claimIssuedAt;
  if (!issuedAt) {
    return true;
  }
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) {
    return true;
  }
  const staleAfterMs =
    params.staleAfterMs ?? DEPOSIT_SLIP_OCR_CHUNK_CLAIM_STALE_MS;
  return params.nowMs - issuedMs >= staleAfterMs;
}

export function resolveDepositSlipOcrFrameChunkSize(
  envValue: string | undefined = process.env.DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE,
): number {
  if (envValue == null || envValue.trim() === "") {
    return DEFAULT_DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE;
  }
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE;
  }
  return Math.min(parsed, 200);
}

export function readDepositSlipOcrChunkState(
  timingsJson: unknown,
): DepositSlipOcrChunkState | null {
  if (timingsJson == null || typeof timingsJson !== "object") {
    return null;
  }
  const raw = (timingsJson as Record<string, unknown>)[
    DEPOSIT_SLIP_OCR_CHUNK_STATE_KEY
  ];
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }
  const nextFrameOffset = record.nextFrameOffset;
  const totalFrames = record.totalFrames;
  const chunkSize = record.chunkSize;
  const claimToken = record.claimToken;
  const claimIssuedAt = record.claimIssuedAt;
  if (
    claimToken !== undefined &&
    claimToken !== null &&
    typeof claimToken !== "string"
  ) {
    return null;
  }
  if (
    claimIssuedAt !== undefined &&
    claimIssuedAt !== null &&
    typeof claimIssuedAt !== "string"
  ) {
    return null;
  }
  if (
    typeof nextFrameOffset !== "number" ||
    !Number.isInteger(nextFrameOffset) ||
    nextFrameOffset < 0 ||
    typeof totalFrames !== "number" ||
    !Number.isInteger(totalFrames) ||
    totalFrames < 0 ||
    typeof chunkSize !== "number" ||
    !Number.isInteger(chunkSize) ||
    chunkSize < 1
  ) {
    return null;
  }
  return {
    version: 1,
    nextFrameOffset,
    totalFrames,
    chunkSize,
    claimToken:
      claimToken === undefined
        ? undefined
        : claimToken === null
          ? null
          : claimToken,
    claimIssuedAt:
      claimIssuedAt === undefined
        ? undefined
        : claimIssuedAt === null
          ? null
          : claimIssuedAt,
  };
}

export function writeDepositSlipOcrChunkState(
  timingsJson: Record<string, unknown> | null | undefined,
  state: DepositSlipOcrChunkState,
): Record<string, unknown> {
  return {
    ...(timingsJson ?? {}),
    [DEPOSIT_SLIP_OCR_CHUNK_STATE_KEY]: state,
  };
}

export function clearDepositSlipOcrChunkState(
  timingsJson: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = { ...(timingsJson ?? {}) };
  delete next[DEPOSIT_SLIP_OCR_CHUNK_STATE_KEY];
  return next;
}

export function depositSlipOcrChunkWindow(params: {
  nextFrameOffset: number;
  totalFrames: number;
  chunkSize: number;
}): { start: number; end: number; frameCount: number; isFinal: boolean } {
  const start = Math.max(0, Math.min(params.nextFrameOffset, params.totalFrames));
  const end = Math.min(start + params.chunkSize, params.totalFrames);
  return {
    start,
    end,
    frameCount: Math.max(0, end - start),
    isFinal: end >= params.totalFrames,
  };
}

/** True when ocrRawJson includes a per-frame deposit-slip history payload. */
export function videoFrameHasDepositSlipHistory(ocrRawJson: unknown): boolean {
  if (ocrRawJson == null || typeof ocrRawJson !== "object") {
    return false;
  }
  const history = (ocrRawJson as Record<string, unknown>).history;
  return history != null && typeof history === "object";
}

/**
 * First contiguous frame index lacking history, or `totalFrames` when complete.
 * Assumes dense frameIndex 0..n-1 ordered ascending.
 */
export function resolveDepositSlipOcrOffsetFromFrames(
  frames: ReadonlyArray<{ frameIndex: number; ocrRawJson: unknown }>,
): number {
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    if (frame.frameIndex !== i) {
      // Non-dense indexes — fall back to first missing history by scan order.
      break;
    }
    if (!videoFrameHasDepositSlipHistory(frame.ocrRawJson)) {
      return i;
    }
  }
  for (const frame of frames) {
    if (!videoFrameHasDepositSlipHistory(frame.ocrRawJson)) {
      return frame.frameIndex;
    }
  }
  return frames.length;
}

/**
 * Resume cursor for the next OCR chunk.
 * Prefer the persisted cursor, but never skip frames that still lack history
 * (worker killed mid-chunk after some frame writes, or a stale cursor).
 */
export function resolveDepositSlipOcrResumeOffset(params: {
  storedState: DepositSlipOcrChunkState | null;
  frames: ReadonlyArray<{ frameIndex: number; ocrRawJson: unknown }>;
}): number {
  const fromFrames =
    params.frames.length > 0
      ? resolveDepositSlipOcrOffsetFromFrames(params.frames)
      : 0;
  if (params.storedState == null) {
    return fromFrames;
  }
  return Math.min(params.storedState.nextFrameOffset, fromFrames);
}
