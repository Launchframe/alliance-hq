import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Mirror of the private advisoryLockPair in roster-ashed-sync-lock.server.ts
 * so we lock the key namespace without opening a live Postgres session.
 */
function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("roster-ashed-sync:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

describe("alliance roster Ashed sync advisory lock key", () => {
  it("derives a stable pair per alliance and differs across alliances", () => {
    const a = advisoryLockPair("alliance-1");
    const aAgain = advisoryLockPair("alliance-1");
    const b = advisoryLockPair("alliance-2");

    expect(a).toEqual(aAgain);
    expect(a).not.toEqual(b);
  });

  it("does not collide with bank-deposit or Ashed score-replace lock namespaces", () => {
    const material = "alliance-1";
    const rosterPair = advisoryLockPair(material);
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
    expect(rosterPair).not.toEqual(bankPair);
    expect(rosterPair).not.toEqual(ashedPair);
  });

  it("uses withAllianceRosterAshedSyncLock instead of pooled pg_advisory_lock", () => {
    const source = readFileSync(
      new URL("./roster-ashed-sync-lock.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("withAllianceRosterAshedSyncLock");
    expect(source).toContain("roster-ashed-sync:");
    expect(source).not.toMatch(/pg_advisory_lock\(hashtext/);
    expect(source).not.toMatch(/pg_advisory_unlock\(hashtext/);
  });

  it("wraps syncAllianceMembersFromAshed with the per-alliance lock", () => {
    const source = readFileSync(
      new URL("./roster.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("withAllianceRosterAshedSyncLock");
    expect(source).toMatch(
      /syncAllianceMembersFromAshed[\s\S]*withAllianceRosterAshedSyncLock/,
    );
    expect(source).toContain("lte(schema.allianceMembers.syncedAt, input.now)");
  });
});
