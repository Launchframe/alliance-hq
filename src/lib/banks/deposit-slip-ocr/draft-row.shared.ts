/**
 * Map deposit-slip OCR drafts ↔ parsed_rows review scratchpad columns.
 *
 * Convention (no schema migration in MVP):
 * - ocrName ← commanderName
 * - score ← amount
 * - powerLevel ← depositAt ISO
 * - memberLevel ← termDays
 * - profession ← status
 * - allianceRankTitle ← alliance tag
 * - rosterRankRaw ← outcomeKind
 * - rank ← outcomeAmount
 */

import type { ParsedDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import type { DepositStatus, DepositTermDays } from "@/lib/banks/types.shared";
import { DEPOSIT_STATUSES, DEPOSIT_TERMS } from "@/lib/banks/types.shared";

export type DepositSlipParsedRowFields = {
  ocrName: string;
  score: string | null;
  powerLevel: string | null;
  memberLevel: number | null;
  profession: string | null;
  allianceRankTitle: string | null;
  rosterRankRaw: string | null;
  rank: number | null;
  frameIndex: number | null;
};

export function depositSlipDraftToParsedRowFields(
  draft: ParsedDepositSlipDraft,
): DepositSlipParsedRowFields {
  return {
    ocrName: draft.identity.commanderName,
    score: draft.amount != null ? String(draft.amount) : null,
    powerLevel: draft.depositAt,
    memberLevel: draft.termDays,
    profession: draft.status,
    allianceRankTitle: draft.identity.allianceTag,
    rosterRankRaw: draft.outcomeKind,
    rank: draft.outcomeAmount,
    frameIndex: draft.sourceFrameIndex ?? null,
  };
}

export function parsedRowFieldsToDepositSlipDraft(
  row: DepositSlipParsedRowFields,
): ParsedDepositSlipDraft | null {
  const commanderName = row.ocrName?.trim();
  if (!commanderName) return null;

  const amountRaw = row.score?.trim() ?? "";
  const amount = amountRaw ? Number(amountRaw) : null;
  if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
    return null;
  }

  const termDays =
    row.memberLevel != null &&
    (DEPOSIT_TERMS as readonly number[]).includes(row.memberLevel)
      ? (row.memberLevel as DepositTermDays)
      : null;

  const status =
    row.profession &&
    (DEPOSIT_STATUSES as readonly string[]).includes(row.profession)
      ? (row.profession as DepositStatus)
      : "locked";

  const outcomeKind =
    row.rosterRankRaw === "total_return" ||
    row.rosterRankRaw === "early_termination_refund"
      ? row.rosterRankRaw
      : null;

  return {
    depositAt: row.powerLevel?.trim() || null,
    termDays,
    amount: amount != null && Number.isFinite(amount) ? Math.trunc(amount) : null,
    status,
    outcomeAmount: row.rank ?? null,
    outcomeKind,
    identity: {
      gameServerNumber: null,
      allianceTag: row.allianceRankTitle?.trim() || null,
      commanderName,
      rawIdentity: commanderName,
    },
    sourceFrameIndex: row.frameIndex ?? undefined,
  };
}
