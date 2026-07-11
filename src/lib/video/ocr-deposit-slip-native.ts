import "server-only";

import { parseDepositSlipImage } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-image.server";
import {
  mergeDepositSlipHistoryParses,
  type ParsedDepositSlipHistory,
} from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { mapWithConcurrency } from "@/lib/video/map-with-concurrency";
import { logPipelineStep } from "@/lib/video/pipeline-step-log";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";

/** One frame at a time — native OCR shares a single tesseract.js worker. */
export const NATIVE_DEPOSIT_SLIP_TESSERACT_CONCURRENCY = 1;

export type NativeDepositSlipFrameTiming = {
  frameIndex: number;
  ms: number;
  entryCount: number;
  error: string | null;
  rawLines: string[];
};

export type OcrDepositSlipNativeFramesResult = {
  history: ParsedDepositSlipHistory;
  frameTimings: NativeDepositSlipFrameTiming[];
  concurrency: number;
};

export async function ocrDepositSlipNativeFrames(
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: {
    timer?: PipelineTimer;
    jobId?: string;
  },
): Promise<OcrDepositSlipNativeFramesResult> {
  const concurrency = NATIVE_DEPOSIT_SLIP_TESSERACT_CONCURRENCY;
  const timer = options?.timer;

  timer?.logStep("tesseract.deposit_slip_batch_start", 0, {
    jobId: options?.jobId,
    frameCount: frames.length,
    concurrency,
  });

  const frameResults = await mapWithConcurrency(
    frames,
    concurrency,
    async (frame) => {
      const started = Date.now();
      try {
        const result = await parseDepositSlipImage(frame.buffer);
        const slips = result.slips.map((slip) => ({
          ...slip,
          sourceFrameIndex: frame.index,
        }));
        return {
          frameIndex: frame.index,
          ms: Date.now() - started,
          entryCount: slips.length,
          error: null as string | null,
          rawLines: result.rawLines,
          history: {
            depositPolicy: result.depositPolicy,
            minimumDeposit: result.minimumDeposit,
            slips,
          } satisfies ParsedDepositSlipHistory,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Deposit slip OCR failed.";
        logPipelineStep("tesseract.deposit_slip_frame_error", Date.now() - started, {
          jobId: options?.jobId,
          frameIndex: frame.index,
          error: message,
        });
        return {
          frameIndex: frame.index,
          ms: Date.now() - started,
          entryCount: 0,
          error: message,
          rawLines: [] as string[],
          history: {
            depositPolicy: null,
            minimumDeposit: null,
            slips: [],
          } satisfies ParsedDepositSlipHistory,
        };
      }
    },
  );

  const history = mergeDepositSlipHistoryParses(
    frameResults.map((frame) => frame.history),
  );

  return {
    history,
    frameTimings: frameResults.map((frame) => ({
      frameIndex: frame.frameIndex,
      ms: frame.ms,
      entryCount: frame.entryCount,
      error: frame.error,
      rawLines: frame.rawLines,
    })),
    concurrency,
  };
}
