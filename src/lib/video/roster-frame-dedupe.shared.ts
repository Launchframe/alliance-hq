/**
 * Cross-frame fuzzy dedupe for roster video member rows.
 *
 * A scrolling roster video shows each member in several overlapping frames,
 * and OCR often reads the same name slightly differently between frames
 * ("Gitolitosito" vs "G1tolitosito"). Exact-name collapse
 * (`collapseRosterMembersByNameRank`) already merged identical readings; this
 * pass clusters the near-miss variants from neighboring frames so the officer
 * can pick the correct spelling in review, mirroring the deposit-slip flagged
 * dedupe cluster flow.
 */

import { nanoid } from "nanoid";

import { normalizeEntityName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";
import type {
  DedupeCluster,
  DedupeClusterMemberSnapshot,
  DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";
import { stringSimilarity } from "@/lib/video/member-matcher";
import type { ExtractedRosterMember } from "@/lib/video/roster-extract";

/** Max frame-index distance for two rows to count as "neighboring frames". */
export const ROSTER_FUZZY_FRAME_WINDOW = 2;

/**
 * Similarity floor for flagging near-miss name variants. Deliberately below
 * the deposit-slip auto-merge threshold — roster variants are flagged for
 * officer choice, never silently merged, so a looser floor is safe.
 */
export const ROSTER_FUZZY_FLAG_THRESHOLD = 0.8;

export const ROSTER_FUZZY_FLAG_REASON =
  "similar_roster_name_neighboring_frames";

export type DedupedRosterMember = ExtractedRosterMember & {
  /** Provisional id — becomes parsed_rows.id so report snapshots stay linked. */
  rowId: string;
  /** Set only on flagged near-miss variants awaiting officer resolution. */
  dedupeClusterId: string | null;
};

export type DedupeRosterMembersResult = {
  members: DedupedRosterMember[];
  report: DedupeReport;
};

type IndexedRow = {
  index: number;
  rowId: string;
  member: ExtractedRosterMember;
  normalized: string;
};

function completeness(row: ExtractedRosterMember): number {
  let score = 0;
  if (row.heroPowerM != null) score += 2;
  if (row.memberLevel != null) score += 1;
  if (row.allianceRank != null) score += 1;
  return score;
}

function ranksCompatible(
  a: ExtractedRosterMember,
  b: ExtractedRosterMember,
): boolean {
  if (a.allianceRank == null || b.allianceRank == null) return true;
  return a.allianceRank === b.allianceRank;
}

function inNeighboringFrames(
  a: ExtractedRosterMember,
  b: ExtractedRosterMember,
  window: number,
): boolean {
  const fa = a._sourceFrameIndex;
  const fb = b._sourceFrameIndex;
  if (fa == null || fb == null) return false;
  const distance = Math.abs(fa - fb);
  // Same-frame near-misses are two visually distinct list rows — two real
  // members — so only pair rows from *different* nearby frames.
  return distance > 0 && distance <= window;
}

function snapshotOf(row: IndexedRow): DedupeClusterMemberSnapshot {
  return {
    slipId: row.rowId,
    snapshot: {
      currentName: row.member.currentName,
      allianceRank: row.member.allianceRank,
      powerLevel: row.member.powerLevel,
      memberLevel: row.member.memberLevel,
      frameIndex: row.member._sourceFrameIndex ?? null,
    },
  };
}

/** Fill missing fields on the survivor from dropped same-name duplicates. */
function absorbInto(
  survivor: ExtractedRosterMember,
  dropped: ExtractedRosterMember,
  correctedFields: Set<string>,
): ExtractedRosterMember {
  const next = { ...survivor };
  if (next.heroPowerM == null && dropped.heroPowerM != null) {
    next.heroPowerM = dropped.heroPowerM;
    next.powerLevel = dropped.powerLevel;
    correctedFields.add("powerLevel");
  }
  if (next.memberLevel == null && dropped.memberLevel != null) {
    next.memberLevel = dropped.memberLevel;
    correctedFields.add("memberLevel");
  }
  if (next.allianceRank == null && dropped.allianceRank != null) {
    next.allianceRank = dropped.allianceRank;
    next.rosterRankRaw = dropped.rosterRankRaw;
    correctedFields.add("allianceRank");
  }
  return next;
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root]!;
    let cur = i;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur]!;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Cluster near-miss roster name variants across neighboring frames.
 *
 * - Rows whose *normalized* names are identical (decoration/case differences
 *   the exact collapse missed) are auto-merged into the richest row.
 * - Rows whose normalized names are merely similar (>= threshold) in
 *   neighboring frames are all kept, sharing a `dedupeClusterId`, so the
 *   review UI can offer a keep-one choice.
 */
export function dedupeRosterMembersAcrossFrames(
  members: readonly ExtractedRosterMember[],
  options?: {
    allianceTag?: string | null;
    frameWindow?: number;
    flagThreshold?: number;
  },
): DedupeRosterMembersResult {
  const frameWindow = options?.frameWindow ?? ROSTER_FUZZY_FRAME_WINDOW;
  const flagThreshold = options?.flagThreshold ?? ROSTER_FUZZY_FLAG_THRESHOLD;

  const rows: IndexedRow[] = members.map((member, index) => ({
    index,
    rowId: nanoid(16),
    member,
    normalized: normalizeEntityName(member.currentName, options?.allianceTag),
  }));

  const uf = new UnionFind(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (!a.normalized || !b.normalized) continue;
      if (!ranksCompatible(a.member, b.member)) continue;

      if (a.normalized === b.normalized) {
        uf.union(i, j);
        continue;
      }
      if (!inNeighboringFrames(a.member, b.member, frameWindow)) continue;
      if (stringSimilarity(a.normalized, b.normalized) >= flagThreshold) {
        uf.union(i, j);
      }
    }
  }

  const buckets = new Map<number, IndexedRow[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const root = uf.find(i);
    const bucket = buckets.get(root) ?? [];
    bucket.push(rows[i]!);
    buckets.set(root, bucket);
  }

  const clusters: DedupeCluster[] = [];
  const survivorByIndex = new Map<number, DedupedRosterMember>();
  let autoMergedCount = 0;

  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      const row = bucket[0]!;
      survivorByIndex.set(row.index, {
        ...row.member,
        rowId: row.rowId,
        dedupeClusterId: null,
      });
      continue;
    }

    // Collapse rows whose normalized names are identical, keeping the richest.
    const byName = new Map<string, IndexedRow[]>();
    for (const row of bucket) {
      const group = byName.get(row.normalized) ?? [];
      group.push(row);
      byName.set(row.normalized, group);
    }

    const correctedFields = new Set<string>();
    const survivors: IndexedRow[] = [];
    for (const group of byName.values()) {
      const sorted = [...group].sort(
        (a, b) => completeness(b.member) - completeness(a.member),
      );
      let best = sorted[0]!;
      for (const dropped of sorted.slice(1)) {
        best = {
          ...best,
          member: absorbInto(best.member, dropped.member, correctedFields),
        };
        autoMergedCount += 1;
      }
      survivors.push(best);
    }

    const destination = [...survivors].sort(
      (a, b) => completeness(b.member) - completeness(a.member),
    )[0]!;

    if (survivors.length === 1) {
      // Pure duplicate readings — auto-merge, no officer action needed.
      survivorByIndex.set(destination.index, {
        ...destination.member,
        rowId: destination.rowId,
        dedupeClusterId: null,
      });
      clusters.push({
        clusterId: `c_${nanoid(16)}`,
        disposition: "auto_merged",
        reason: "identical_roster_name_variants",
        destinationSlipId: destination.rowId,
        members: bucket.map(snapshotOf),
        ...(correctedFields.size > 0
          ? { correctedFields: [...correctedFields] }
          : {}),
      });
      continue;
    }

    // Near-miss variants — keep every distinct spelling, flag for review.
    const clusterId = `c_${nanoid(16)}`;
    for (const survivor of survivors) {
      survivorByIndex.set(survivor.index, {
        ...survivor.member,
        rowId: survivor.rowId,
        dedupeClusterId: clusterId,
      });
    }
    clusters.push({
      clusterId,
      disposition: "flagged",
      reason: ROSTER_FUZZY_FLAG_REASON,
      destinationSlipId: destination.rowId,
      members: bucket.map(snapshotOf),
    });
  }

  const output = [...survivorByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, member]) => member);

  return {
    members: output,
    report: {
      clusters,
      autoMergedCount,
      flaggedCount: clusters.filter((c) => c.disposition === "flagged").length,
      inputCount: members.length,
      outputCount: output.length,
    },
  };
}
