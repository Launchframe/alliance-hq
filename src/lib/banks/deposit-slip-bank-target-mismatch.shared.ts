import type { DetectedBankContext } from "@/lib/banks/bank-context-ocr/merge-bank-context.shared";

export type BankTargetSnapshot = {
  gameServerNumber: number;
  coordX: number;
  coordY: number;
};

export type BankTargetMismatchState =
  | "aligned"
  | "mismatch"
  | "insufficient_detected";

export type BankTargetMismatchResolution = "targeted" | "video";

/**
 * Compare upload-target bank coords against video-detected bank context.
 *
 * A bank is unique by `[gameServerNumber, coordX, coordY]` only — two banks
 * cannot occupy the same coordinates on the same server, so a detected
 * level is never part of bank identity. Level is excluded from this
 * comparison on purpose: a video showing the targeted bank at a different
 * level than HQ has on file just means the bank leveled up/down since HQ
 * last saw it, not that the video is targeting a different bank. Only
 * coordinate/server differences represent a genuine "different bank"
 * mismatch that needs officer resolution.
 */
export function compareTargetedBankToDetected(
  targeted: BankTargetSnapshot,
  detected: DetectedBankContext | null,
): BankTargetMismatchState {
  if (!detected) return "insufficient_detected";

  const { gameServerNumber, coordX, coordY } = detected;
  if (gameServerNumber == null || coordX == null || coordY == null) {
    return "insufficient_detected";
  }

  const coordsDiffer =
    targeted.gameServerNumber !== gameServerNumber ||
    targeted.coordX !== coordX ||
    targeted.coordY !== coordY;

  return coordsDiffer ? "mismatch" : "aligned";
}
