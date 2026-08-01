import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { isBankDepositSlipHistoryTarget } from "@/lib/video/score-targets";

/** Validates alliance-scoped bank id for Deposit Slip History video uploads. */
export async function resolveDepositSlipUploadBankId(
  allianceId: string | null,
  scoreTarget: string,
  bankId: string | undefined | null,
): Promise<string | null> {
  if (!isBankDepositSlipHistoryTarget(scoreTarget)) {
    return null;
  }
  const trimmed = bankId?.trim();
  if (!trimmed || !allianceId) {
    return null;
  }
  const db = getDb();
  const [bank] = await db
    .select({ id: schema.banks.id })
    .from(schema.banks)
    .where(
      and(
        eq(schema.banks.id, trimmed),
        eq(schema.banks.allianceId, allianceId),
      ),
    )
    .limit(1);
  return bank?.id ?? null;
}
