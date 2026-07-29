import type { DetectedBankContext } from "@/lib/banks/bank-context-ocr/merge-bank-context.shared";

export type BankTargetSnapshot = {
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
};

export type BankTargetMismatchState =
  | "aligned"
  | "mismatch"
  | "insufficient_detected";

export type BankTargetMismatchResolution = "targeted" | "video";

/**
 * Compare upload-target bank coords against video-detected bank context.
 */
export function compareTargetedBankToDetected(
  targeted: BankTargetSnapshot,
  detected: DetectedBankContext | null,
): BankTargetMismatchState {
  if (!detected) return "insufficient_detected";

  const { gameServerNumber, coordX, coordY, level } = detected;
  if (gameServerNumber == null || coordX == null || coordY == null) {
    return "insufficient_detected";
  }

  const coordsDiffer =
    targeted.gameServerNumber !== gameServerNumber ||
    targeted.coordX !== coordX ||
    targeted.coordY !== coordY;
  const levelDiffers =
    level != null && Number.isFinite(level) && targeted.level !== level;

  if (coordsDiffer || levelDiffers) return "mismatch";
  return "aligned";
}
