import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Mirror of the private advisoryLockPair in bank-deposit-commit-lock.server.ts
 * so we lock the key namespace without opening a live Postgres session.
 */
function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("bank-deposit-commit:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

describe("bank deposit commit advisory lock key", () => {
  it("derives a stable pair per alliance+bank and differs across banks", () => {
    const a = advisoryLockPair("alliance-1\0bank-1");
    const aAgain = advisoryLockPair("alliance-1\0bank-1");
    const b = advisoryLockPair("alliance-1\0bank-2");
    const otherAlliance = advisoryLockPair("alliance-2\0bank-1");

    expect(a).toEqual(aAgain);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(otherAlliance);
  });

  it("does not collide with the Ashed score-replace lock namespace", () => {
    const bankPair = advisoryLockPair("alliance-1\0bank-1");
    const ashedDigest = createHash("sha256")
      .update("ashed-score-replace:")
      .update("alliance-1\0bank-deposit-slip-history\x002026-07-10")
      .digest();
    const ashedPair: [number, number] = [
      ashedDigest.readInt32BE(0),
      ashedDigest.readInt32BE(4),
    ];
    expect(bankPair).not.toEqual(ashedPair);
  });
});
