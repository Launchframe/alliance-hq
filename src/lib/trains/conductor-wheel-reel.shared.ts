export type WheelReelCandidate = {
  memberId: string;
  memberName: string;
};

export function uniqueWheelCandidateNames(
  candidates: WheelReelCandidate[],
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.memberId)) continue;
    seen.add(candidate.memberId);
    names.push(candidate.memberName);
  }
  return names;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Stable per-seed shuffle for share viewports (varies by day/winner, reproducible on re-export). */
export function seededShuffle<T>(arr: T[], seed: string): T[] {
  const a = [...arr];
  if (a.length <= 1) return a;

  let state = hashSeed(seed) || 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };

  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export type ReelBuildOptions = {
  fastSpeed?: number;
  fastSecs?: number;
  slowSecs?: number;
  visible?: number;
};

export type ReelSession = {
  items: string[];
  fastEndY: number;
  targetY: number;
  winnerIdx: number;
  key: string;
};

/** Build slot-machine reel items; avoids duplicate names in the resting viewport when possible. */
export function buildConductorWheelReelSession(
  candidates: WheelReelCandidate[],
  winner: WheelReelCandidate,
  options: ReelBuildOptions = {},
): ReelSession {
  const ITEM_H = 80;
  const VISIBLE = options.visible ?? 3;
  const FAST_SPEED = options.fastSpeed ?? 30;
  const FAST_SECS = options.fastSecs ?? 2.5;
  const SLOW_SECS = options.slowSecs ?? 1.8;
  const CENTER_OFFSET = Math.floor(VISIBLE / 2) * ITEM_H;

  const names = uniqueWheelCandidateNames(candidates);
  if (names.length === 0) {
    names.push(winner.memberName);
  }

  const fastItemCount = Math.ceil(FAST_SPEED * FAST_SECS);
  const fastPasses = Math.ceil(fastItemCount / names.length);
  const decelItemCount = Math.ceil((FAST_SPEED * SLOW_SECS) / 2);
  const slowPasses = Math.max(3, Math.ceil(decelItemCount / names.length));

  const items: string[] = [];
  for (let i = 0; i < fastPasses; i += 1) items.push(...shuffle(names));
  for (let i = 0; i < slowPasses; i += 1) items.push(...shuffle(names));

  const alternates = shuffle(names.filter((name) => name !== winner.memberName));

  // Ensure the item immediately before the winner is not the winner's name.
  if (items.length > 0 && alternates.length > 0 && items[items.length - 1] === winner.memberName) {
    items[items.length - 1] = alternates[0]!;
  }

  const winnerIdx = items.length;
  items.push(winner.memberName);

  const padCount = Math.floor(VISIBLE / 2) + 1;
  for (let i = 0; i < padCount; i += 1) {
    if (alternates.length > 0) {
      items.push(alternates[i % alternates.length]!);
    } else {
      items.push(winner.memberName);
    }
  }

  // Guarantee the resting viewport (visible slots around the winner) has no
  // duplicate names. With ≥3 unique candidates this is always possible; with
  // exactly 2, the two non-winner slots will necessarily share a name — in
  // that case keep them and do not attempt swaps.
  if (alternates.length >= 2) {
    const halfV = Math.floor(VISIBLE / 2);
    const viewStart = winnerIdx - halfV;
    const viewEnd = winnerIdx + halfV;
    const usedInView = new Set<string>();
    usedInView.add(winner.memberName);

    for (let idx = viewStart; idx <= viewEnd; idx += 1) {
      if (idx === winnerIdx || idx < 0 || idx >= items.length) continue;
      if (usedInView.has(items[idx]!)) {
        const replacement = alternates.find(
          (name) => !usedInView.has(name),
        );
        if (replacement) {
          items[idx] = replacement;
        }
      }
      usedInView.add(items[idx]!);
    }
  }

  const fastEndY = fastPasses * names.length * ITEM_H;
  const targetY = winnerIdx * ITEM_H - CENTER_OFFSET;

  return {
    items,
    fastEndY,
    targetY,
    winnerIdx,
    key: `${winner.memberId}:${winnerIdx}:${items.length}`,
  };
}

/** Visible names when the reel stops (for tests / debugging). */
export function restingViewportNames(
  session: ReelSession,
  visible = 3,
): string[] {
  const centerOffset = Math.floor(visible / 2);
  const start = session.winnerIdx - centerOffset;
  return session.items.slice(start, start + visible);
}

/**
 * Winner plus unique neighbor names. Never clones a name to fill empty slots —
 * a short roster yields a short reel instead of "BOGGLE / BOGGLE".
 */
export function uniqueCenteredShareViewport(
  winnerName: string,
  preferredNeighbors: readonly string[],
  surroundingCount = 4,
): { names: string[]; winnerIndex: number } {
  const half = Math.ceil(surroundingCount / 2);
  const seen = new Set<string>([winnerName]);
  const above: string[] = [];
  const below: string[] = [];

  for (const name of preferredNeighbors) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (above.length <= below.length && above.length < half) {
      above.push(name);
    } else if (below.length < half) {
      below.push(name);
    } else if (above.length < half) {
      above.push(name);
    }
    if (above.length >= half && below.length >= half) break;
  }

  return {
    names: [...above, winnerName, ...below],
    winnerIndex: above.length,
  };
}

function namesOutwardFromWinner(session: ReelSession): string[] {
  const preferred: string[] = [];
  for (let distance = 1; distance < session.items.length; distance += 1) {
    const left = session.winnerIdx - distance;
    const right = session.winnerIdx + distance;
    if (left >= 0) preferred.push(session.items[left]!);
    if (right < session.items.length) preferred.push(session.items[right]!);
  }
  return preferred;
}

/** Winner plus surrounding unique names for share images (default: up to 2 above + 2 below). */
export function restingShareViewport(
  session: ReelSession,
  surroundingCount = 4,
): { names: string[]; winnerIndex: number } {
  const winnerName = session.items[session.winnerIdx] ?? "";
  return uniqueCenteredShareViewport(
    winnerName,
    namesOutwardFromWinner(session),
    surroundingCount,
  );
}

/**
 * Share viewport for re-export after the wheel closes.
 * Winner is centered; surrounding names are shuffled so repeat exports do not
 * always show the same roster-order neighbors (looks rigged). Pass `seed` (e.g.
 * `${date}:${memberId}`) so re-export for the same day is stable but different
 * draws vary.
 */
export function buildShareViewportForWinner(
  winner: WheelReelCandidate,
  candidates: WheelReelCandidate[],
  options?: { surroundingCount?: number; seed?: string },
): { names: string[]; winnerIndex: number } {
  const surroundingCount = options?.surroundingCount ?? 4;
  const others = seededShuffle(
    uniqueWheelCandidateNames(
      candidates.filter(
        (candidate) =>
          candidate.memberId !== winner.memberId &&
          candidate.memberName !== winner.memberName,
      ),
    ),
    options?.seed ?? `${winner.memberId}:${winner.memberName}`,
  );
  return uniqueCenteredShareViewport(
    winner.memberName,
    others,
    surroundingCount,
  );
}

export function restingShareViewportNames(
  session: ReelSession,
  surroundingCount = 4,
): string[] {
  return restingShareViewport(session, surroundingCount).names;
}

export function winnerIndexInShareViewport(
  session: ReelSession,
  surroundingCount = 4,
): number {
  return restingShareViewport(session, surroundingCount).winnerIndex;
}
