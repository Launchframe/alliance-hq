import { describe, expect, it } from "vitest";

import { groupPendingDepositSlipVideoReviewsByBank } from "@/lib/banks/pending-deposit-slip-video-reviews.shared";

describe("groupPendingDepositSlipVideoReviewsByBank", () => {
  it("groups by bank and keeps the first job id for review links", () => {
    expect(
      groupPendingDepositSlipVideoReviewsByBank([
        { bankId: "bank-a", jobId: "job-1" },
        { bankId: "bank-a", jobId: "job-2" },
        { bankId: "bank-b", jobId: "job-3" },
        { bankId: null, jobId: "job-orphan" },
      ]),
    ).toEqual({
      "bank-a": { count: 2, firstJobId: "job-1" },
      "bank-b": { count: 1, firstJobId: "job-3" },
    });
  });
});
