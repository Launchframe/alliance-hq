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
 * - rosterRankRaw ← outcomeKind (optional `@outcomeAt` ISO suffix for lifecycle merges)
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

const OUTCOME_KIND_VALUES = [
  "total_return",
  "early_termination_refund",
] as const;

function encodeRosterRankRaw(
  outcomeKind: ParsedDepositSlipDraft["outcomeKind"],
  outcomeAt: string | null | undefined,
): string | null {
  if (!outcomeKind) return null;
  const at = outcomeAt?.trim();
  return at ? `${outcomeKind}@${at}` : outcomeKind;
}

function decodeRosterRankRaw(raw: string | null | undefined): {
  outcomeKind: ParsedDepositSlipDraft["outcomeKind"];
  outcomeAt: string | null;
} {
  if (!raw?.trim()) return { outcomeKind: null, outcomeAt: null };
  const atIdx = raw.indexOf("@");
  const kindPart = atIdx >= 0 ? raw.slice(0, atIdx) : raw;
  const outcomeAt = atIdx >= 0 ? raw.slice(atIdx + 1).trim() || null : null;
  const outcomeKind =
    kindPart === "total_return" || kindPart === "early_termination_refund"
      ? kindPart
      : null;
  if (
    outcomeKind &&
    !(OUTCOME_KIND_VALUES as readonly string[]).includes(outcomeKind)
  ) {
    return { outcomeKind: null, outcomeAt: null };
  }
  return { outcomeKind, outcomeAt };
}

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
    rosterRankRaw: encodeRosterRankRaw(draft.outcomeKind, draft.outcomeAt),
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

  const { outcomeKind, outcomeAt } = decodeRosterRankRaw(row.rosterRankRaw);

  return {
    depositAt: row.powerLevel?.trim() || null,
    termDays,
    amount: amount != null && Number.isFinite(amount) ? Math.trunc(amount) : null,
    status,
    outcomeAmount: row.rank ?? null,
    outcomeKind,
    outcomeAt,
    identity: {
      gameServerNumber: null,
      allianceTag: row.allianceRankTitle?.trim() || null,
      commanderName,
      rawIdentity: commanderName,
    },
    sourceFrameIndex: row.frameIndex ?? undefined,
  };
}
