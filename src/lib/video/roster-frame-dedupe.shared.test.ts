import { describe, expect, it } from "vitest";

import type { ExtractedRosterMember } from "@/lib/video/roster-extract";
import {
  dedupeRosterMembersAcrossFrames,
  ROSTER_FUZZY_FLAG_REASON,
} from "@/lib/video/roster-frame-dedupe.shared";

function member(
  name: string,
  overrides?: Partial<ExtractedRosterMember>,
): ExtractedRosterMember {
  return {
    currentName: name,
    rosterRankRaw: null,
    allianceRank: null,
    allianceRankTitle: null,
    powerLevel: null,
    heroPowerM: null,
    memberLevel: null,
    profession: null,
    status: null,
    ...overrides,
  };
}

describe("dedupeRosterMembersAcrossFrames", () => {
  it("flags near-miss name variants from neighboring frames for officer review", () => {
    // The PwbbPR7NgQOnni3F case: same member, OCR flipped i → 1 between frames.
    const result = dedupeRosterMembersAcrossFrames([
      member("Gitolitosito", {
        allianceRank: 3,
        heroPowerM: 94.1,
        _sourceFrameIndex: 5,
      }),
      member("G1tolitosito", { allianceRank: 3, _sourceFrameIndex: 6 }),
    ]);

    expect(result.members).toHaveLength(2);
    const [a, b] = result.members;
    expect(a!.dedupeClusterId).not.toBeNull();
    expect(a!.dedupeClusterId).toBe(b!.dedupeClusterId);

    expect(result.report.flaggedCount).toBe(1);
    const cluster = result.report.clusters[0]!;
    expect(cluster.disposition).toBe("flagged");
    expect(cluster.reason).toBe(ROSTER_FUZZY_FLAG_REASON);
    // Destination prefers the richer reading (has power).
    expect(cluster.destinationSlipId).toBe(a!.rowId);
    expect(cluster.members).toHaveLength(2);
  });

  it("does not cluster similar names from distant frames", () => {
    const result = dedupeRosterMembersAcrossFrames([
      member("Gitolitosito", { allianceRank: 3, _sourceFrameIndex: 0 }),
      member("G1tolitosito", { allianceRank: 3, _sourceFrameIndex: 10 }),
    ]);

    expect(result.members).toHaveLength(2);
    expect(result.members.every((m) => m.dedupeClusterId === null)).toBe(true);
    expect(result.report.flaggedCount).toBe(0);
  });

  it("does not cluster similar names within the same frame (two real list rows)", () => {
    const result = dedupeRosterMembersAcrossFrames([
      member("Gitolitosito", { allianceRank: 2, _sourceFrameIndex: 4 }),
      member("G1tolitosito", { allianceRank: 2, _sourceFrameIndex: 4 }),
    ]);

    expect(result.members).toHaveLength(2);
    expect(result.report.flaggedCount).toBe(0);
  });

  it("does not cluster similar names with conflicting ranks", () => {
    const result = dedupeRosterMembersAcrossFrames([
      member("Gitolitosito", { allianceRank: 3, _sourceFrameIndex: 5 }),
      member("G1tolitosito", { allianceRank: 4, _sourceFrameIndex: 6 }),
    ]);

    expect(result.members).toHaveLength(2);
    expect(result.report.flaggedCount).toBe(0);
  });

  it("auto-merges rows whose normalized names are identical, filling missing stats", () => {
    // Exact collapse compares raw lowercase names, so decoration variants survive it.
    const result = dedupeRosterMembersAcrossFrames([
      member("@ Blackie Nut", { allianceRank: 3, _sourceFrameIndex: 1 }),
      member("Blackie Nut", {
        allianceRank: 3,
        heroPowerM: 12.4,
        powerLevel: "12.4M",
        _sourceFrameIndex: 3,
      }),
    ]);

    expect(result.members).toHaveLength(1);
    const survivor = result.members[0]!;
    expect(survivor.dedupeClusterId).toBeNull();
    expect(survivor.heroPowerM).toBe(12.4);

    expect(result.report.autoMergedCount).toBe(1);
    expect(result.report.flaggedCount).toBe(0);
    expect(result.report.clusters[0]?.disposition).toBe("auto_merged");
    expect(result.report.inputCount).toBe(2);
    expect(result.report.outputCount).toBe(1);

    // The destination's snapshot must reflect the absorbed stats, not its
    // pre-merge reading, so dedupeReportJson matches the persisted row.
    const destinationSnapshot = result.report.clusters[0]!.members.find(
      (m) => m.slipId === survivor.rowId,
    );
    expect(destinationSnapshot?.snapshot.powerLevel).toBe("12.4M");
  });

  it("clusters across a null rank (early frame before any header was seen)", () => {
    const result = dedupeRosterMembersAcrossFrames([
      member("Gitolitosito", { allianceRank: 3, _sourceFrameIndex: 5 }),
      member("G1tolitosito", { allianceRank: null, _sourceFrameIndex: 6 }),
    ]);

    expect(result.report.flaggedCount).toBe(1);
  });

  it("leaves unrelated members untouched with unique row ids", () => {
    const result = dedupeRosterMembersAcrossFrames([
      member("Alice", { allianceRank: 3, _sourceFrameIndex: 0 }),
      member("Bobcat", { allianceRank: 3, _sourceFrameIndex: 1 }),
      member("Charlie", { allianceRank: 4, _sourceFrameIndex: 2 }),
    ]);

    expect(result.members).toHaveLength(3);
    expect(new Set(result.members.map((m) => m.rowId)).size).toBe(3);
    expect(result.members.every((m) => m.dedupeClusterId === null)).toBe(true);
    expect(result.report.clusters).toHaveLength(0);
  });
});
