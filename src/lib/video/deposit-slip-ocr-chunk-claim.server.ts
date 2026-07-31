import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  DEPOSIT_SLIP_OCR_CHUNK_CLAIM_STALE_MS,
  DEPOSIT_SLIP_OCR_CHUNK_STATE_KEY,
  type DepositSlipOcrChunkState,
  writeDepositSlipOcrChunkState,
} from "@/lib/video/deposit-slip-ocr-chunks.shared";
import {
  DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY,
  type DepositSlipFingerprintShadowChunkState,
  writeDepositSlipFingerprintShadowChunkState,
} from "@/lib/video/deposit-slip-fingerprint-shadow-chunks.shared";

export function createDepositSlipOcrChunkClaimToken(): string {
  return nanoid(12);
}

export type DepositSlipOcrChunkClaimResult =
  | {
      claimed: true;
      claimToken: string;
      timingsJson: Record<string, unknown>;
    }
  | { claimed: false };

function unclaimedChunkWhere(
  stateKey: string,
  expectedOffset: number,
  staleClaimCutoffIso: string,
) {
  const chunkJson = sql`${schema.videoJobs.timingsJson}->${stateKey}`;
  const offsetJson = sql`(${chunkJson}->>'nextFrameOffset')::int`;
  const claimJson = sql`coalesce(${chunkJson}->>'claimToken', '')`;
  const claimIssuedAtJson = sql`coalesce(${chunkJson}->>'claimIssuedAt', '')`;

  return sql`(
    ${chunkJson} IS NULL
    OR (
      ${offsetJson} = ${expectedOffset}
      AND (
        ${claimJson} = ''
        OR ${claimIssuedAtJson} = ''
        OR (${claimIssuedAtJson})::timestamptz < ${staleClaimCutoffIso}::timestamptz
      )
    )
  )`;
}

function staleClaimCutoffIso(now: Date): string {
  return new Date(
    now.getTime() - DEPOSIT_SLIP_OCR_CHUNK_CLAIM_STALE_MS,
  ).toISOString();
}

/**
 * Atomically claim the next deposit-slip primary OCR chunk so only one worker
 * invocation processes frames at `expectedOffset` (prevents duplicate OCR when
 * cron and fire-and-forget dispatch race).
 */
export async function claimDepositSlipOcrChunk(params: {
  jobId: string;
  expectedOffset: number;
  totalFrames: number;
  chunkSize: number;
  priorTimingsJson: Record<string, unknown> | null | undefined;
  now: Date;
}): Promise<DepositSlipOcrChunkClaimResult> {
  const claimToken = createDepositSlipOcrChunkClaimToken();
  const chunkState: DepositSlipOcrChunkState = {
    version: 1,
    nextFrameOffset: params.expectedOffset,
    totalFrames: params.totalFrames,
    chunkSize: params.chunkSize,
    claimToken,
    claimIssuedAt: params.now.toISOString(),
  };
  const nextTimings = writeDepositSlipOcrChunkState(
    params.priorTimingsJson,
    chunkState,
  );

  const db = getDb();
  const [claimed] = await db
    .update(schema.videoJobs)
    .set({ timingsJson: nextTimings, updatedAt: params.now })
    .where(
      and(
        eq(schema.videoJobs.id, params.jobId),
        unclaimedChunkWhere(
          DEPOSIT_SLIP_OCR_CHUNK_STATE_KEY,
          params.expectedOffset,
          staleClaimCutoffIso(params.now),
        ),
      ),
    )
    .returning({ id: schema.videoJobs.id });

  if (!claimed) {
    return { claimed: false };
  }
  return { claimed: true, claimToken, timingsJson: nextTimings };
}

/**
 * Same atomic claim for the fingerprint-shadow pass (preserves prior chunk
 * OCR lines while claiming the next frame window).
 */
export async function claimDepositSlipFingerprintShadowChunk(params: {
  jobId: string;
  expectedOffset: number;
  totalFrames: number;
  chunkSize: number;
  priorChunk: DepositSlipFingerprintShadowChunkState | null;
  priorTimingsJson: Record<string, unknown> | null | undefined;
  now: Date;
}): Promise<DepositSlipOcrChunkClaimResult> {
  const claimToken = createDepositSlipOcrChunkClaimToken();
  const chunkState: DepositSlipFingerprintShadowChunkState = {
    version: 1,
    nextFrameOffset: params.expectedOffset,
    totalFrames: params.totalFrames,
    chunkSize: params.chunkSize,
    claimToken,
    claimIssuedAt: params.now.toISOString(),
    frameLines: params.priorChunk?.frameLines ?? [],
    ocrFrameMs: params.priorChunk?.ocrFrameMs ?? [],
  };
  const nextTimings = writeDepositSlipFingerprintShadowChunkState(
    params.priorTimingsJson,
    chunkState,
  );

  const db = getDb();
  const [claimed] = await db
    .update(schema.videoJobs)
    .set({ timingsJson: nextTimings, updatedAt: params.now })
    .where(
      and(
        eq(schema.videoJobs.id, params.jobId),
        unclaimedChunkWhere(
          DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY,
          params.expectedOffset,
          staleClaimCutoffIso(params.now),
        ),
      ),
    )
    .returning({ id: schema.videoJobs.id });

  if (!claimed) {
    return { claimed: false };
  }
  return { claimed: true, claimToken, timingsJson: nextTimings };
}

/** Release the chunk claim after OCR completes (next worker may proceed). */
export function releaseDepositSlipOcrChunkClaim(
  state: DepositSlipOcrChunkState,
): DepositSlipOcrChunkState {
  return { ...state, claimToken: null, claimIssuedAt: null };
}

export function releaseDepositSlipFingerprintShadowChunkClaim(
  state: DepositSlipFingerprintShadowChunkState,
): DepositSlipFingerprintShadowChunkState {
  return { ...state, claimToken: null, claimIssuedAt: null };
}
