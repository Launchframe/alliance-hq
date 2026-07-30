import { describe, expect, it } from "vitest";

import { formatDepositSlipSubmitSuccessMessage } from "@/lib/banks/deposit-slip-submit-success.shared";

describe("formatDepositSlipSubmitSuccessMessage", () => {
  const t = (key: string, values?: { count: number }) => {
    if (key === "depositSlipSubmitAdded") {
      return `Added ${values?.count} new deposit slip(s) to this bank.`;
    }
    if (key === "depositSlipSubmitSuccess") {
      return `Saved ${values?.count} deposit slips to Bank Management.`;
    }
    if (key === "depositSlipSubmitSkippedDuplicates") {
      return `Skipped ${values?.count} that already matched history.`;
    }
    return key;
  };

  it("includes skipped duplicate count when new rows were added", () => {
    expect(
      formatDepositSlipSubmitSuccessMessage(t, {
        createdCount: 2,
        skippedDuplicateCount: 3,
      }),
    ).toBe(
      "Added 2 new deposit slip(s) to this bank. Skipped 3 that already matched history.",
    );
  });

  it("reuses the saved message when only outcomes were updated", () => {
    expect(
      formatDepositSlipSubmitSuccessMessage(t, {
        createdCount: 0,
        updatedCount: 1,
        skippedDuplicateCount: 2,
      }),
    ).toBe(
      "Saved 1 deposit slips to Bank Management. Skipped 2 that already matched history.",
    );
  });

  it("omits the skipped clause when nothing was skipped", () => {
    expect(
      formatDepositSlipSubmitSuccessMessage(t, { createdCount: 3 }),
    ).toBe("Added 3 new deposit slip(s) to this bank.");
    expect(
      formatDepositSlipSubmitSuccessMessage(t, {
        createdCount: 0,
        updatedCount: 2,
      }),
    ).toBe("Saved 2 deposit slips to Bank Management.");
  });

  it("falls back to submitted when createdCount is omitted", () => {
    expect(
      formatDepositSlipSubmitSuccessMessage(t, { submitted: 4 }),
    ).toBe("Added 4 new deposit slip(s) to this bank.");
  });

  it("defaults every count to zero when the payload is empty", () => {
    expect(formatDepositSlipSubmitSuccessMessage(t, {})).toBe(
      "Added 0 new deposit slip(s) to this bank.",
    );
  });
});
