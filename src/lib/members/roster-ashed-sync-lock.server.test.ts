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
    expect(source).not.toContain("void syncAllianceMembersFromAshed");
    expect(source).toContain("syncGeneration: claim.startedAt");
    expect(source).toContain("skippedBecauseRunning");
    expect(source).toMatch(
      /after\(\(\) =>\s*syncAllianceMembersFromAshed/,
    );
  });

  it("fences sync completion and serializes roster edits with the sync lock", () => {
    const status = readFileSync(
      new URL("./roster-ashed-sync-status.server.ts", import.meta.url),
      "utf8",
    );
    const lock = readFileSync(
      new URL("./roster-ashed-sync-lock.server.ts", import.meta.url),
      "utf8",
    );
    const ranks = readFileSync(
      new URL("../../app/api/members/ranks/route.ts", import.meta.url),
      "utf8",
    );
    const nameRoute = readFileSync(
      new URL("../../app/api/members/[ashedMemberId]/route.ts", import.meta.url),
      "utf8",
    );
    const mergeRoute = readFileSync(
      new URL(
        "../../app/api/members/[ashedMemberId]/merge-duplicate/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const bulk = readFileSync(
      new URL("./bulk-rank-update.server.ts", import.meta.url),
      "utf8",
    );
    const merge = readFileSync(
      new URL("./merge-duplicate-commander.server.ts", import.meta.url),
      "utf8",
    );
    const name = readFileSync(
      new URL("./commander-identity.server.ts", import.meta.url),
      "utf8",
    );

    expect(status).toContain("rosterAshedSyncGenerationStillOwns");
    expect(status).toContain("eq(schema.alliances.rosterAshedSyncStartedAt, generationStartedAt)");
    expect(lock).toContain("withAllianceRosterMutationLock");
    expect(lock).toMatch(
      /withAllianceRosterMutationLock[\s\S]*assertAllianceRosterAshedSyncIdle/,
    );
    expect(ranks).toContain("skipAshedSync: true");
    expect(ranks).not.toContain("assertAllianceRosterAshedSyncIdle");
    expect(nameRoute).not.toContain("assertAllianceRosterAshedSyncIdle");
    expect(mergeRoute).not.toContain("assertAllianceRosterAshedSyncIdle");
    expect(bulk).toContain("withAllianceRosterMutationLock");
    expect(merge).toContain("withAllianceRosterMutationLock");
    expect(name).toContain("withAllianceRosterMutationLock");
  });
});
