/**
 * Fuzzy entity-name clustering for OCR rows (commanders, members, etc.).
 */

import { stringSimilarity } from "@/lib/video/member-matcher";
import { stripParsedNameDecorations } from "@/lib/video/normalize-rows";

/** Default similarity for high-confidence auto-merge clusters. */
export const FUZZY_AUTO_MERGE_THRESHOLD = 0.85;

/** Similarity band that should be flagged for officer review, not auto-merged. */
export const FUZZY_FLAG_MIN_THRESHOLD = 0.7;

/**
 * Normalize a free-text entity name for fuzzy comparison:
 * strip alliance tags / server prefixes, leading OCR junk, and special characters.
 */
export function normalizeEntityName(
  raw: string,
  allianceTag?: string | null,
): string {
  let s = stripParsedNameDecorations(raw, allianceTag);
  // Prefer the commander segment after an in-game identity prefix when present.
  const identityTail = s.match(/#\d{3,5}\s*(?:\[\s*[^\]]*\s*\])?\s*(.+)$/i);
  if (identityTail?.[1]) {
    s = identityTail[1];
  } else {
    // Drop leading OCR junk, then any glued/spaced server prefix.
    s = s.replace(/^[^a-zA-Z0-9]+/, "");
    s = s.replace(/^#\d{3,5}\s*/i, "");
    s = s.replace(/^#\d{3,5}/i, "");
  }
  s = s.replace(/[^a-zA-Z0-9\s]+/g, "");
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) {
      root = this.parent[root]!;
    }
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
 * Cluster rows whose normalized names are within `threshold` similarity
 * (union-find over pairwise comparisons). Returns clusters of original rows
 * (singletons included when `includeSingletons` is true).
 */
export function clusterByFuzzyName<T>(
  rows: readonly T[],
  getName: (row: T) => string,
  options?: {
    threshold?: number;
    allianceTag?: string | null;
    includeSingletons?: boolean;
  },
): T[][] {
  const threshold = options?.threshold ?? FUZZY_AUTO_MERGE_THRESHOLD;
  const includeSingletons = options?.includeSingletons ?? false;
  if (rows.length === 0) return [];

  const normalized = rows.map((row) =>
    normalizeEntityName(getName(row), options?.allianceTag),
  );
  const uf = new UnionFind(rows.length);

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = normalized[i]!;
      const b = normalized[j]!;
      if (!a || !b) continue;
      if (a === b || stringSimilarity(a, b) >= threshold) {
        uf.union(i, j);
      }
    }
  }

  const buckets = new Map<number, T[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const root = uf.find(i);
    const bucket = buckets.get(root);
    if (bucket) {
      bucket.push(rows[i]!);
    } else {
      buckets.set(root, [rows[i]!]);
    }
  }

  const clusters = [...buckets.values()];
  if (includeSingletons) return clusters;
  return clusters.filter((c) => c.length >= 2);
}

/** Best pairwise similarity between two sets of names (normalized). */
export function bestNameSimilarity(
  aNames: readonly string[],
  bNames: readonly string[],
  allianceTag?: string | null,
): number {
  let best = 0;
  for (const a of aNames) {
    const na = normalizeEntityName(a, allianceTag);
    if (!na) continue;
    for (const b of bNames) {
      const nb = normalizeEntityName(b, allianceTag);
      if (!nb) continue;
      best = Math.max(best, stringSimilarity(na, nb));
    }
  }
  return best;
}
