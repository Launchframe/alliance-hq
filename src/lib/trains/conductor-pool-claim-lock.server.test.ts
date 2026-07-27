import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Mirror of the private advisoryLockPair in conductor-pool-claim-lock.server.ts
 * so we lock the key namespace without opening a live Postgres session.
 */
function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("conductor-pool-claim:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

describe("conductor pool claim advisory lock key", () => {
  it("derives a stable pair per alliance+poolType and differs across pools", () => {
    const a = advisoryLockPair("alliance-1\0r3");
    const aAgain = advisoryLockPair("alliance-1\0r3");
    const b = advisoryLockPair("alliance-1\0r4_plus");
    const otherAlliance = advisoryLockPair("alliance-2\0r3");

    expect(a).toEqual(aAgain);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(otherAlliance);
  });

  it("does not collide with bank-deposit or Ashed score-replace lock namespaces", () => {
    const poolPair = advisoryLockPair("alliance-1\0r3");

    const bankDigest = createHash("sha256")
      .update("bank-deposit-commit:")
      .update("alliance-1\0r3")
      .digest();
    const bankPair: [number, number] = [
      bankDigest.readInt32BE(0),
      bankDigest.readInt32BE(4),
    ];

    const ashedDigest = createHash("sha256")
      .update("ashed-score-replace:")
      .update("alliance-1\0r3\x002026-07-10")
      .digest();
    const ashedPair: [number, number] = [
      ashedDigest.readInt32BE(0),
      ashedDigest.readInt32BE(4),
    ];

    expect(poolPair).not.toEqual(bankPair);
    expect(poolPair).not.toEqual(ashedPair);
  });
});
