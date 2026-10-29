/** Client-safe roster duplicate grouping. No database imports. */

import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";

/**
 * Mirrors the October 2026 Caos split: older LastRank rows (`hq-native:`)
 * carry commander stats, newer Ashed rows are thin, and the Ashed row is the
 * one to keep. Stats never choose the keeper.
 */
export type RosterDuplicateCandidate = {
  ashedMemberId: string;
  name: string;
  synthetic: boolean;
  linkedAccount: boolean;
  hasGameUid: boolean;
  /** Epoch milliseconds. Older wins the last tie-break. */
  createdAt: number;
};

export type RosterDuplicateGroupKind = "exact" | "review" | "ambiguous";

export type RosterDuplicateGroup = {
  id: string;
  kind: RosterDuplicateGroupKind;
  keeperAshedMemberId: string | null;
  memberIds: string[];
};

export type RosterDuplicateInexactPair = {
  keeperName: string;
  duplicateName: string;
};

export type RosterDuplicateMemberView = {
  ashedMemberId: string;
  name: string;
  synthetic: boolean;
  linkedAccount: boolean;
  hasGameUid: boolean;
  defaultChecked: boolean;
  keeper: boolean;
  powerLevel: string | null;
  memberLevel: number | null;
  totalHeroPower: number | null;
  profession: string | null;
};

export type RosterDuplicateGroupView = {
  id: string;
  kind: RosterDuplicateGroupKind;
  keeperAshedMemberId: string | null;
  members: RosterDuplicateMemberView[];
};

export type RosterDuplicateScan = {
  hasBotCredential: boolean;
  groups: RosterDuplicateGroupView[];
  unmatchedLastRank: RosterDuplicateMemberView[];
};

const MIN_FUZZY_LENGTH = 6;

/**
 * Dedup key: NFC + lowercase/trim, keep Unicode letters/numbers/marks, drop
 * punctuation. ASCII-only stripping collapsed distinct CJK names that shared a
 * Latin suffix (e.g. 玩家One / 队长One → "one").
 */
export function strippedCommanderName(name: string): string {
  return normalizeCommanderName(name)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

/** Real Ashed row, then an HQ or Discord link, then a game UID, then the older row. */
export function chooseRosterDuplicateKeeper(
  members: readonly RosterDuplicateCandidate[],
): string | null {
  if (members.length === 0) return null;
  const ranked = [...members].sort((a, b) => {
    const realAshed = Number(a.synthetic) - Number(b.synthetic);
    if (realAshed !== 0) return realAshed;
    const linked = Number(b.linkedAccount) - Number(a.linkedAccount);
    if (linked !== 0) return linked;
    const uid = Number(b.hasGameUid) - Number(a.hasGameUid);
    if (uid !== 0) return uid;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.ashedMemberId < b.ashedMemberId ? -1 : 1;
  });
  return ranked[0]?.ashedMemberId ?? null;
}

export function groupRosterDuplicates(members: readonly RosterDuplicateCandidate[]): {
  groups: RosterDuplicateGroup[];
  unmatchedSyntheticIds: string[];
} {
  const exactBuckets = new Map<string, RosterDuplicateCandidate[]>();
  for (const member of members) {
    const key = strippedCommanderName(member.name);
    if (!key) continue;
    const bucket = exactBuckets.get(key) ?? [];
    bucket.push(member);
    exactBuckets.set(key, bucket);
  }

  const groups: RosterDuplicateGroup[] = [];
  const consumed = new Set<string>();

  for (const bucket of exactBuckets.values()) {
    if (bucket.length < 2) continue;
    const memberIds = bucket.map((member) => member.ashedMemberId).sort();
    for (const id of memberIds) consumed.add(id);
    groups.push({
      id: memberIds.join("|"),
      kind: "exact",
      keeperAshedMemberId: chooseRosterDuplicateKeeper(bucket),
      memberIds,
    });
  }

  const pool = members.filter((member) => !consumed.has(member.ashedMemberId));
  const edges: Array<[string, string]> = [];
  for (let left = 0; left < pool.length; left += 1) {
    for (let right = left + 1; right < pool.length; right += 1) {
      const a = pool[left];
      const b = pool[right];
      if (!a || !b) continue;
      if (namesNeedReview(a.name, b.name)) {
        edges.push([a.ashedMemberId, b.ashedMemberId]);
      }
    }
  }

  const degree = new Map<string, number>();
  for (const [left, right] of edges) {
    degree.set(left, (degree.get(left) ?? 0) + 1);
    degree.set(right, (degree.get(right) ?? 0) + 1);
  }

  for (const component of connectedComponents(
    pool.map((member) => member.ashedMemberId),
    edges,
  )) {
    if (component.length < 2) continue;
    const componentMembers = pool.filter((member) =>
      component.includes(member.ashedMemberId),
    );
    const ambiguous =
      component.length !== 2 ||
      component.some((id) => (degree.get(id) ?? 0) > 1);
    const memberIds = [...component].sort();
    for (const id of memberIds) consumed.add(id);
    groups.push({
      id: memberIds.join("|"),
      kind: ambiguous ? "ambiguous" : "review",
      keeperAshedMemberId: ambiguous
        ? null
        : chooseRosterDuplicateKeeper(componentMembers),
      memberIds,
    });
  }

  groups.sort((a, b) => {
    const kindOrder = { exact: 0, review: 1, ambiguous: 2 };
    const byKind = kindOrder[a.kind] - kindOrder[b.kind];
    if (byKind !== 0) return byKind;
    return a.id < b.id ? -1 : 1;
  });

  const unmatchedSyntheticIds = members
    .filter((member) => member.synthetic && !consumed.has(member.ashedMemberId))
    .map((member) => member.ashedMemberId)
    .sort();

  return { groups, unmatchedSyntheticIds };
}

export function reviewMergePairs(
  groups: readonly RosterDuplicateGroup[],
  names: ReadonlyMap<string, string>,
  selectedIds: ReadonlySet<string>,
): RosterDuplicateInexactPair[] {
  const pairs: RosterDuplicateInexactPair[] = [];
  for (const group of groups) {
    if (group.kind !== "review" || !group.keeperAshedMemberId) continue;
    const keeperName = names.get(group.keeperAshedMemberId);
    if (!keeperName) continue;
    for (const memberId of group.memberIds) {
      if (memberId === group.keeperAshedMemberId) continue;
      if (!selectedIds.has(memberId)) continue;
      const duplicateName = names.get(memberId);
      if (!duplicateName) continue;
      pairs.push({ keeperName, duplicateName });
    }
  }
  return pairs;
}

export function selectionIncludesAmbiguous(
  groups: readonly RosterDuplicateGroup[],
  selectedIds: ReadonlySet<string>,
): boolean {
  for (const group of groups) {
    if (group.kind !== "ambiguous") continue;
    if (group.memberIds.some((id) => selectedIds.has(id))) return true;
  }
  return false;
}

function namesNeedReview(leftName: string, rightName: string): boolean {
  const left = strippedCommanderName(leftName);
  const right = strippedCommanderName(rightName);
  if (!left || !right || left === right) return false;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length >= MIN_FUZZY_LENGTH && longer.includes(shorter)) {
    return true;
  }
  return editDistanceIsOne(left, right);
}

function editDistanceIsOne(left: string, right: string): boolean {
  if (left.length < MIN_FUZZY_LENGTH || right.length < MIN_FUZZY_LENGTH) {
    return false;
  }
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length === right.length) {
      i += 1;
      j += 1;
    } else if (left.length > right.length) {
      i += 1;
    } else {
      j += 1;
    }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits === 1;
}

function connectedComponents(
  ids: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    parent.set(id, root);
    return root;
  };
  for (const [left, right] of edges) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  }
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    const list = buckets.get(root) ?? [];
    list.push(id);
    buckets.set(root, list);
  }
  return [...buckets.values()];
}
