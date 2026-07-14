import "server-only";

import { and, eq } from "drizzle-orm";

import type { DepositSlipPayload } from "@/lib/banks/api.shared";
import { validateDepositSlipPayload } from "@/lib/banks/api.shared";
import { isDepositSlipAutoLinkedMatchMethod } from "@/lib/banks/deposit-slip-ocr/deposit-slip-member-match.shared";
import { parsedRowFieldsToDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import {
  createDepositSlipMemberResolverCache,
  resolveDepositSlipMemberLinks,
} from "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server";
import { createDepositSlip } from "@/lib/banks/repository.server";
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
  skippedCount: number;
  errors: string[];
};

async function loadParsedRowLinkMeta(
  parseSessionId: string,
): Promise<
  Map<string, { memberId: string | null; matchMethod: string | null }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.parsedRows.id,
      memberId: schema.parsedRows.memberId,
      matchMethod: schema.parsedRows.matchMethod,
    })
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, parseSessionId));
  return new Map(
    rows.map((row) => [
      row.id,
      { memberId: row.memberId, matchMethod: row.matchMethod },
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
      frameIndex: row.frameIndex,
      deleted: false,
      memberId: row.memberId,
      matchMethod: row.matchMethod,
    }));
  }

  let createdCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  // Share one alliance-tag fetch and one roster fetch per alliance across the
  // whole commit instead of re-querying per row.
  const resolverDeps = createDepositSlipMemberResolverCache();

  for (const row of rows) {
    const draft = parsedRowFieldsToDepositSlipDraft(row);
    if (!draft || draft.amount == null || !draft.depositAt || draft.termDays == null) {
      skippedCount += 1;
      errors.push(
        `Row ${row.id}: missing commander, amount, deposit time, or term.`,
      );
      continue;
    }

    const meta = linkMetaByRowId.get(row.id);
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

    const payload: DepositSlipPayload = {
      bankId: input.bankId,
      depositAt: draft.depositAt,
      termDays: draft.termDays,
      amount: draft.amount,
      status: draft.status,
      outcomeAt:
        draft.status === "matured" || draft.status === "looted"
          ? draft.depositAt
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

    await createDepositSlip(input.allianceId, payload);
    createdCount += 1;
  }

  if (createdCount === 0) {
    throw new Error(
      errors[0] ?? "No valid deposit slips to commit.",
    );
  }

  return { createdCount, skippedCount, errors };
}
