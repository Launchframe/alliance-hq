import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Mirror of the private advisoryLockPair in
 * scoreboard-member-create-lock.server.ts so we lock the key namespace without
 * opening a live Postgres session.
 */
function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("scoreboard-member-create:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

describe("scoreboard member create advisory lock key", () => {
  it("derives a stable pair per alliance+normalized name and differs across names", () => {
    const a = advisoryLockPair("alliance-1\0bat pig");
    const aAgain = advisoryLockPair("alliance-1\0bat pig");
    const b = advisoryLockPair("alliance-1\0other");
    const otherAlliance = advisoryLockPair("alliance-2\0bat pig");

    expect(a).toEqual(aAgain);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(otherAlliance);
  });

  it("does not collide with bank-deposit or Ashed score-replace lock namespaces", () => {
    const material = "alliance-1\0bat pig";
    const scoreboardPair = advisoryLockPair(material);

    const bankDigest = createHash("sha256")
      .update("bank-deposit-commit:")
      .update(material)
      .digest();
    const bankPair: [number, number] = [
      bankDigest.readInt32BE(0),
      bankDigest.readInt32BE(4),
    ];

    const ashedDigest = createHash("sha256")
      .update("ashed-score-replace:")
      .update(material)
      .digest();
    const ashedPair: [number, number] = [
      ashedDigest.readInt32BE(0),
      ashedDigest.readInt32BE(4),
    ];

    expect(scoreboardPair).not.toEqual(bankPair);
    expect(scoreboardPair).not.toEqual(ashedPair);
  });

  it("client options keep idle_timeout 0 so Ashed HTTP cannot drop the session lock", async () => {
    const { scoreboardMemberCreateLockClientOptions } = await import(
      "./scoreboard-member-create-lock.server"
    );
    const opts = scoreboardMemberCreateLockClientOptions();
    expect(opts.max).toBe(1);
    expect(opts.idle_timeout).toBe(0);
  });
});

describe("createScoreboardMembersFromReview lock wiring (source)", () => {
  it("uses withScoreboardMemberCreateLock instead of pooled pg_advisory_lock", () => {
    const source = readFileSync(
      new URL("./scoreboard-member-actions.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("withScoreboardMemberCreateLock");
    expect(source).not.toMatch(/pg_advisory_lock\(hashtext/);
    expect(source).not.toMatch(/pg_advisory_unlock\(hashtext/);
  });
});
