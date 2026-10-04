import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeJoinCode } from "./join-codes";

describe("normalizeJoinCode", () => {
  it("uppercases and strips spaces", () => {
    expect(normalizeJoinCode(" lfgo-abc 123 ")).toBe("LFGO-ABC123");
  });
});

describe("redeemAllianceJoinCode atomicity", () => {
  it("claims the redemption slot and inserts the row inside one transaction", () => {
    // Regression guard: bumping redemptionCount then inserting the redemption
    // row in separate statements could burn the last (or only) slot when the
    // insert failed, leaving the user unable to retry.
    const source = readFileSync(
      path.join(import.meta.dirname, "join-codes.ts"),
      "utf8",
    );
    expect(source).toMatch(/db\.transaction\s*\(/);
    expect(source).toMatch(/JoinCodeCasConflictError/);
    const claimIdx = source.indexOf(
      "redemptionCount: joinCode.redemptionCount + 1",
    );
    const insertIdx = source.indexOf(
      "tx.insert(schema.hqAllianceJoinCodeRedemptions)",
    );
    expect(claimIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(claimIdx);
  });
});
