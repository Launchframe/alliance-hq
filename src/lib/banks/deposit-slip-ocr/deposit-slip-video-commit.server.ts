import "server-only";

import { and, eq } from "drizzle-orm";

import type { DepositSlipPayload } from "@/lib/banks/api.shared";
import { validateDepositSlipPayload } from "@/lib/banks/api.shared";
import {
  findHighConfidenceHistoricalDepositMatch,
  shouldSkipHistoricalDepositDuplicate,
  shouldUpdateHistoricalDepositOutcome,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-history-match.shared";
import { isDepositSlipAutoLinkedMatchMethod } from "@/lib/banks/deposit-slip-ocr/deposit-slip-member-match.shared";
import { parsedRowFieldsToDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import {
  createDepositSlipMemberResolverCache,
  resolveDepositSlipMemberLinks,
} from "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server";
import {
  createDepositSlip,
  listDepositSlipsForBank,
  updateDepositSlip,
} from "@/lib/banks/repository.server";
import type { DepositStatus } from "@/lib/banks/types.shared";
import { getDb, schema } from "@/lib/db";

export type DepositSlipVideoCommitRow = {
  id: string;
  ocrName: string;
  score: string | null;
  powerLevel: string | null;
  memberLevel: number | null;
  profession: string | null;
  allianceRankTitle: string | null;
  rosterRankRaw: string | null;
  rank?: number | null;
  frameIndex: number | null;
  deleted: boolean;
  /** Optional overrides; otherwise loaded from `parsed_rows` at commit. */
  memberId?: string | null;
  matchMethod?: string | null;
};

export type CommitDepositSlipsFromVideoJobInput = {
  allianceId: string;
  bankId: string;
  parseSessionId: string;
  /** Optional overrides from the review submit body (edited rows). */
  rows?: DepositSlipVideoCommitRow[];
};

export type CommitDepositSlipsFromVideoJobResult = {
  createdCount: number;
  /** Incomplete / invalid rows (not history duplicates). */
  skippedCount: number;
  /** High-confidence matches against slips already stored for this bank. */
  skippedDuplicateCount: number;
  /** Locked slips advanced to matured/looted from iterative OCR. */
  updatedCount: number;
  errors: string[];
};

async function loadParsedRowLinkMeta(
  parseSessionId: string,
): Promise<
  Map<
    string,
    {
      memberId: string | null;
      matchMethod: string | null;
      /** Scratchpad for outcomeAmount (see draft-row.shared). */
      rank: number | null;
    }
  >
> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.parsedRows.id,
      memberId: schema.parsedRows.memberId,
      matchMethod: schema.parsedRows.matchMethod,
      rank: schema.parsedRows.rank,
    })
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, parseSessionId));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        memberId: row.memberId,
        matchMethod: row.matchMethod,
        rank: row.rank,
      },
    ]),
  );
}

export async function commitDepositSlipsFromVideoJob(
  input: CommitDepositSlipsFromVideoJobInput,
): Promise<CommitDepositSlipsFromVideoJobResult> {
  const db = getDb();

  const bankRows = await db
    .select({ id: schema.banks.id })
    .from(schema.banks)
    .where(
      and(
        eq(schema.banks.id, input.bankId),
        eq(schema.banks.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  if (bankRows.length === 0) {
    throw new Error("Bank not found.");
  }

  const linkMetaByRowId = await loadParsedRowLinkMeta(input.parseSessionId);

  let rows: DepositSlipVideoCommitRow[];
  if (input.rows) {
    rows = input.rows.filter((row) => !row.deleted);
  } else {
    const dbRows = await db
      .select()
      .from(schema.parsedRows)
      .where(
        and(
          eq(schema.parsedRows.parseSessionId, input.parseSessionId),
          eq(schema.parsedRows.deleted, 0),
        ),
      );
    rows = dbRows.map((row) => ({
      id: row.id,
      ocrName: row.ocrName,
      score: row.score,
      powerLevel: row.powerLevel,
      memberLevel: row.memberLevel,
      profession: row.profession,
      allianceRankTitle: row.allianceRankTitle,
      rosterRankRaw: row.rosterRankRaw,
      rank: row.rank,
      frameIndex: row.frameIndex,
      deleted: false,
      memberId: row.memberId,
      matchMethod: row.matchMethod,
    }));
  }

  const existingSlips = await listDepositSlipsForBank(
    input.allianceId,
    input.bankId,
  );
  type HistoryRow = {
    id: string;
    commanderName: string;
    depositAt: string;
    amount: number;
    termDays: number;
    depositAllianceTag: string | null;
    status: DepositStatus;
  };
  const history: HistoryRow[] = existingSlips.map((slip) => ({
    id: slip.id,
    commanderName: slip.commanderName,
    depositAt:
      slip.depositAt instanceof Date
        ? slip.depositAt.toISOString()
        : String(slip.depositAt),
    amount: slip.amount,
    termDays: slip.termDays,
    depositAllianceTag: slip.depositAllianceTag,
    status: slip.status as DepositStatus,
  }));

  let createdCount = 0;
  let skippedCount = 0;
  let skippedDuplicateCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  // Share one alliance-tag fetch and one roster fetch per alliance across the
  // whole commit instead of re-querying per row.
  const resolverDeps = createDepositSlipMemberResolverCache();

  for (const row of rows) {
    const meta = linkMetaByRowId.get(row.id);
    // Prefer submit/body rank; fall back to persisted OCR scratchpad so
    // callers that omit rank (legacy review payloads) still persist outcomeAmount.
    const rank = row.rank !== undefined ? row.rank : (meta?.rank ?? null);
    const draft = parsedRowFieldsToDepositSlipDraft({
      ocrName: row.ocrName,
      score: row.score,
      powerLevel: row.powerLevel,
      memberLevel: row.memberLevel,
      profession: row.profession,
      allianceRankTitle: row.allianceRankTitle,
      rosterRankRaw: row.rosterRankRaw,
      rank,
      frameIndex: row.frameIndex,
    });
    if (!draft || draft.amount == null || !draft.depositAt || draft.termDays == null) {
      skippedCount += 1;
      errors.push(
        `Row ${row.id}: missing commander, amount, deposit time, or term.`,
      );
      continue;
    }

    const incoming = {
      commanderName: draft.identity.commanderName,
      depositAt: draft.depositAt,
      amount: draft.amount,
      termDays: draft.termDays,
      depositAllianceTag: draft.identity.allianceTag,
      status: draft.status,
    };
    const historicalMatch = findHighConfidenceHistoricalDepositMatch(
      incoming,
      history,
    );
    if (
      historicalMatch &&
      shouldSkipHistoricalDepositDuplicate(incoming, historicalMatch)
    ) {
      skippedDuplicateCount += 1;
      continue;
    }

    const matchMethod = row.matchMethod ?? meta?.matchMethod ?? null;
    const memberId = row.memberId ?? meta?.memberId ?? null;
    const preferredAshedMemberId =
      isDepositSlipAutoLinkedMatchMethod(matchMethod) && memberId
        ? memberId
        : null;

    const links = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: input.allianceId,
        depositAllianceTag: draft.identity.allianceTag,
        commanderName: draft.identity.commanderName,
        preferredAshedMemberId,
      },
      resolverDeps,
    );

    if (
      historicalMatch &&
      shouldUpdateHistoricalDepositOutcome(incoming, historicalMatch)
    ) {
      const updatePayload: DepositSlipPayload = {
        bankId: input.bankId,
        // Keep the initiate timestamp; OCR time on green/orange is outcomeAt
        // (lifecycle merges may already split depositAt vs outcomeAt).
        depositAt: historicalMatch.depositAt,
        termDays: draft.termDays,
        amount: draft.amount,
        outcomeAmount: draft.outcomeAmount ?? null,
        status: draft.status,
        outcomeAt: draft.outcomeAt ?? draft.depositAt,
        depositAllianceTag: draft.identity.allianceTag,
        depositAllianceId: links.depositAllianceId,
        commanderName: draft.identity.commanderName,
        commanderId: links.commanderId,
        allianceMemberId: links.allianceMemberId,
      };
      const validationError = validateDepositSlipPayload(updatePayload);
      if (validationError) {
        skippedCount += 1;
        errors.push(`Row ${row.id}: ${validationError}`);
        continue;
      }
      await updateDepositSlip(
        input.allianceId,
        historicalMatch.id,
        updatePayload,
      );
      updatedCount += 1;
      historicalMatch.status = draft.status;
      historicalMatch.depositAllianceTag =
        draft.identity.allianceTag?.trim() || null;
      continue;
    }

    const payload: DepositSlipPayload = {
      bankId: input.bankId,
      depositAt: draft.depositAt,
      termDays: draft.termDays,
      amount: draft.amount,
      outcomeAmount: draft.outcomeAmount ?? null,
      status: draft.status,
      outcomeAt:
        draft.status === "matured" || draft.status === "looted"
          ? (draft.outcomeAt ?? draft.depositAt)
          : null,
      depositAllianceTag: draft.identity.allianceTag,
      depositAllianceId: links.depositAllianceId,
      commanderName: draft.identity.commanderName,
      commanderId: links.commanderId,
      allianceMemberId: links.allianceMemberId,
    };

    const validationError = validateDepositSlipPayload(payload);
    if (validationError) {
      skippedCount += 1;
      errors.push(`Row ${row.id}: ${validationError}`);
      continue;
    }

    const created = await createDepositSlip(input.allianceId, payload);
    createdCount += 1;
    // Later rows in this same commit must see the slip we just wrote so a
    // duplicate OCR survivor in one video does not insert twice.
    history.push({
      id: created.id,
      commanderName: incoming.commanderName,
      depositAt: incoming.depositAt,
      amount: incoming.amount,
      termDays: incoming.termDays,
      depositAllianceTag: incoming.depositAllianceTag?.trim() || null,
      status: incoming.status,
    });
  }

  if (
    createdCount === 0 &&
    skippedDuplicateCount === 0 &&
    updatedCount === 0
  ) {
    throw new Error(
      errors[0] ?? "No valid deposit slips to commit.",
    );
  }

  return {
    createdCount,
    skippedCount,
    skippedDuplicateCount,
    updatedCount,
    errors,
  };
}
