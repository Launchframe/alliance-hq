import "server-only";

import { and, asc, eq, isNotNull } from "drizzle-orm";

import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { groupPendingDepositSlipVideoReviewsByBank } from "@/lib/banks/pending-deposit-slip-video-reviews.shared";
import type { BankPendingDepositSlipVideoReview } from "@/lib/banks/types.shared";
import { getDb, schema } from "@/lib/db";

/** Primary deposit-slip jobs in review, grouped by bank (oldest job id per bank). */
export async function loadPendingDepositSlipVideoReviewsByBank(
  allianceId: string,
): Promise<Record<string, BankPendingDepositSlipVideoReview>> {
  const db = getDb();
  const rows = await db
    .select({
      bankId: schema.videoJobs.bankId,
      jobId: schema.videoJobs.id,
    })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.allianceId, allianceId),
        eq(schema.videoJobs.status, "review"),
        eq(schema.videoJobs.passRole, "primary"),
        eq(
          schema.videoJobs.scoreTarget,
          BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET,
        ),
        isNotNull(schema.videoJobs.bankId),
      ),
    )
    .orderBy(asc(schema.videoJobs.createdAt));

  return groupPendingDepositSlipVideoReviewsByBank(rows);
}
