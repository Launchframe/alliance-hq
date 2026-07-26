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

  const alternates = names.filter((name) => name !== winner.memberName);

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

function padShareViewportNames(
  names: string[],
  winnerIndex: number,
  targetLength: number,
): string[] {
  if (names.length >= targetLength) return names;
  const padded = [...names];
  while (padded.length < targetLength) {
    if (winnerIndex > 0) {
      padded.unshift(padded[0]!);
    } else {
      padded.push(padded[padded.length - 1]!);
    }
  }
  return padded.slice(0, targetLength);
}

function finalizeShareViewport(
  names: string[],
  winnerIndex: number,
  surroundingCount: number,
): { names: string[]; winnerIndex: number } {
  const targetLength = surroundingCount + 1;
  const padded =
    names.length < targetLength
      ? padShareViewportNames(names, winnerIndex, targetLength)
      : names;
  return { names: padded.slice(0, targetLength), winnerIndex };
}

/** Winner plus surrounding names for share images (default: 2 above + 2 below). */
export function restingShareViewport(
  session: ReelSession,
  surroundingCount = 4,
): { names: string[]; winnerIndex: number } {
  const half = Math.ceil(surroundingCount / 2);
  const start = Math.max(0, session.winnerIdx - half);
  const end = Math.min(session.items.length - 1, session.winnerIdx + half);
  const names = session.items.slice(start, end + 1);
  const winnerIndex = session.winnerIdx - start;
  return finalizeShareViewport(names, winnerIndex, surroundingCount);
}

/**
 * Deterministic share viewport for re-export after the wheel closes.
 * Winner is centered; surrounding names come from other candidates in order.
 */
export function buildShareViewportForWinner(
  winner: WheelReelCandidate,
  candidates: WheelReelCandidate[],
  surroundingCount = 4,
): { names: string[]; winnerIndex: number } {
  const half = Math.ceil(surroundingCount / 2);
  const others = uniqueWheelCandidateNames(
    candidates.filter(
      (candidate) =>
        candidate.memberId !== winner.memberId &&
        candidate.memberName !== winner.memberName,
    ),
  );
  const above = others.slice(0, half);
  const below = others.slice(half, half + half);
  const names = [...above, winner.memberName, ...below];
  return finalizeShareViewport(names, above.length, surroundingCount);
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
