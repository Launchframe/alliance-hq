import type { BankPendingDepositSlipVideoReview } from "@/lib/banks/types.shared";

export function groupPendingDepositSlipVideoReviewsByBank(
  rows: ReadonlyArray<{ bankId: string | null; jobId: string }>,
): Record<string, BankPendingDepositSlipVideoReview> {
  const byBank: Record<string, BankPendingDepositSlipVideoReview> = {};
  for (const row of rows) {
    if (!row.bankId) continue;
    const existing = byBank[row.bankId];
    if (!existing) {
      byBank[row.bankId] = { count: 1, firstJobId: row.jobId };
    } else {
      existing.count += 1;
    }
  }
  return byBank;
}
