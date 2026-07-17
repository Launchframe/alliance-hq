import type { DetectedBankContext } from "@/lib/banks/bank-context-ocr/merge-bank-context.shared";

export type DetectedBankContextMatch =
  | { kind: "none" }
  | { kind: "partial" }
  | { kind: "unmatched_coords" }
  | { kind: "matched"; bankId: string };

export type BankCoordLookup = {
  id: string;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
};

/**
 * Classify a video-detected bank context against the alliance's existing
 * bank list for the deposit-slip review "auto-select or create" flow.
 *
 * - `none`: no context detected.
 * - `partial`: context detected but missing server/X/Y — never invent coords.
 * - `unmatched_coords`: full coords detected but no bank in the list matches.
 * - `matched`: full coords detected and a bank in the list matches exactly.
 */
export function matchDetectedBankContextToBanks(
  context: DetectedBankContext | null,
  banks: ReadonlyArray<BankCoordLookup>,
): DetectedBankContextMatch {
  if (!context) return { kind: "none" };

  const { gameServerNumber, coordX, coordY } = context;
  if (gameServerNumber == null || coordX == null || coordY == null) {
    return { kind: "partial" };
  }

  const match = banks.find(
    (bank) =>
      bank.gameServerNumber === gameServerNumber &&
      bank.coordX === coordX &&
      bank.coordY === coordY,
  );
  return match ? { kind: "matched", bankId: match.id } : { kind: "unmatched_coords" };
}
