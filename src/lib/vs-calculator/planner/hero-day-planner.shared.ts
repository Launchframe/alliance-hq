import {
  buildHeroDayActions,
  partitionPlannerActions,
} from "@/lib/vs-calculator/planner/hero-day-actions.shared";
import type {
  HeroDayPlan,
  HeroDayPlannerInput,
  HeroDayPlannerMode,
  PlannerAction,
} from "@/lib/vs-calculator/planner/planner-types.shared";

const MAX_UNIQUE_COMBO_SIZE = 12;
const MAX_REPEATABLE_PER_KIND = 40;

function planScore(actions: PlannerAction[]): {
  totalPoints: number;
  diamondPacks: number;
  diamondsPurchased: number;
  inGameActions: number;
} {
  let totalPoints = 0;
  let diamondPacks = 0;
  let diamondsPurchased = 0;
  let inGameActions = 0;
  for (const action of actions) {
    totalPoints += action.vsPoints;
    if (action.kind === "diamond_pack") {
      diamondPacks += 1;
      diamondsPurchased += action.packSize ?? 0;
    } else {
      inGameActions += 1;
    }
  }
  return { totalPoints, diamondPacks, diamondsPurchased, inGameActions };
}

function comparePlans(a: PlannerAction[], b: PlannerAction[]): number {
  const sa = planScore(a);
  const sb = planScore(b);
  if (sa.inGameActions !== sb.inGameActions) {
    return sa.inGameActions - sb.inGameActions;
  }
  const primarySkillIndex = (actions: PlannerAction[]) => {
    let bestIndex = 99;
    let bestSpan = -1;
    for (const action of actions) {
      if (action.kind !== "skill_upgrade") continue;
      const span = (action.toLevel ?? 0) - (action.fromLevel ?? 0);
      if (
        span > bestSpan ||
        (span === bestSpan && (action.skillIndex ?? 99) < bestIndex)
      ) {
        bestSpan = span;
        bestIndex = action.skillIndex ?? 99;
      }
    }
    return bestIndex;
  };
  const skillA = primarySkillIndex(a);
  const skillB = primarySkillIndex(b);
  if (skillA !== skillB) return skillA - skillB;
  if (sa.diamondPacks !== sb.diamondPacks) {
    return sa.diamondPacks - sb.diamondPacks;
  }
  if (sa.diamondsPurchased !== sb.diamondsPurchased) {
    return sa.diamondsPurchased - sb.diamondsPurchased;
  }
  return a.length - b.length;
}

function levelRangesOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

function plannerActionsConflict(a: PlannerAction, b: PlannerAction): boolean {
  if (!a.heroId || a.heroId !== b.heroId) return false;
  if (
    a.kind === "skill_upgrade" &&
    b.kind === "skill_upgrade" &&
    a.skillIndex === b.skillIndex
  ) {
    return levelRangesOverlap(
      a.fromLevel ?? 0,
      a.toLevel ?? 0,
      b.fromLevel ?? 0,
      b.toLevel ?? 0,
    );
  }
  if (a.kind === "hero_level_up" && b.kind === "hero_level_up") {
    return levelRangesOverlap(
      a.fromLevel ?? 0,
      a.toLevel ?? 0,
      b.fromLevel ?? 0,
      b.toLevel ?? 0,
    );
  }
  if (a.kind === "weapon_upgrade" && b.kind === "weapon_upgrade") {
    return levelRangesOverlap(
      a.fromLevel ?? 0,
      a.toLevel ?? 0,
      b.fromLevel ?? 0,
      b.toLevel ?? 0,
    );
  }
  return false;
}

function pickedActionsConflict(
  picked: PlannerAction[],
  candidate: PlannerAction,
): boolean {
  return picked.some((action) => plannerActionsConflict(action, candidate));
}

function searchUniqueSubset(
  unique: PlannerAction[],
  target: number,
  start: number,
  picked: PlannerAction[],
  best: { actions: PlannerAction[] | null },
): void {
  const sum = planScore(picked).totalPoints;
  if (sum === target) {
    if (best.actions == null || comparePlans(best.actions, picked) > 0) {
      best.actions = [...picked];
    }
    return;
  }
  if (sum > target || picked.length >= MAX_UNIQUE_COMBO_SIZE) return;
  if (start >= unique.length) return;

  for (let i = start; i < unique.length; i++) {
    const action = unique[i]!;
    if (sum + action.vsPoints > target) continue;
    if (pickedActionsConflict(picked, action)) continue;
    picked.push(action);
    searchUniqueSubset(unique, target, i + 1, picked, best);
    picked.pop();
  }
}

function fillRemainderWithRepeatable(
  remainder: number,
  repeatable: PlannerAction[],
): PlannerAction[] | null {
  if (remainder === 0) return [];
  const packs = repeatable.filter((a) => a.kind === "diamond_pack");
  if (packs.length === 0) return null;

  const sorted = [...packs].sort((a, b) => b.vsPoints - a.vsPoints);
  const memo = new Map<number, PlannerAction[] | null>();

  function dp(remaining: number, depth: number): PlannerAction[] | null {
    if (remaining === 0) return [];
    if (remaining < 0 || depth > MAX_REPEATABLE_PER_KIND) return null;
    const hit = memo.get(remaining);
    if (hit !== undefined) return hit;

    for (const pack of sorted) {
      const sub = dp(remaining - pack.vsPoints, depth + 1);
      if (sub != null) {
        const result = [pack, ...sub];
        memo.set(remaining, result);
        return result;
      }
    }
    memo.set(remaining, null);
    return null;
  }

  return dp(remainder, 0);
}

function fillRemainderWithRecruits(
  remainder: number,
  repeatable: PlannerAction[],
): PlannerAction[] | null {
  const recruits = repeatable.filter(
    (a) => a.kind === "bag_item" && a.slug === "recruit_ticket",
  );
  if (recruits.length === 0) return null;
  const unit = recruits[0]!.vsPoints;
  if (remainder % unit !== 0) return null;
  const count = remainder / unit;
  if (count > recruits.length) return null;
  return recruits.slice(0, count);
}

function solveExact(
  unique: PlannerAction[],
  repeatable: PlannerAction[],
  gap: number,
): PlannerAction[] | null {
  const best: { actions: PlannerAction[] | null } = { actions: null };

  searchUniqueSubset(unique, gap, 0, [], best);
  if (best.actions != null) return best.actions;

  for (let u = 0; u <= Math.min(unique.length, MAX_UNIQUE_COMBO_SIZE); u++) {
    const pickUnique = (start: number, picked: PlannerAction[]): void => {
      if (picked.length === u) {
        const used = planScore(picked).totalPoints;
        if (used > gap) return;
        const remainder = gap - used;
        const recruits = fillRemainderWithRecruits(remainder, repeatable);
        if (recruits != null) {
          const combined = [...picked, ...recruits];
          if (best.actions == null || comparePlans(best.actions, combined) > 0) {
            best.actions = combined;
          }
          return;
        }
        const packs = fillRemainderWithRepeatable(remainder, repeatable);
        if (packs != null) {
          const combined = [...picked, ...packs];
          if (best.actions == null || comparePlans(best.actions, combined) > 0) {
            best.actions = combined;
          }
        }
        return;
      }
      if (start >= unique.length) return;
      pickUnique(start + 1, picked);
      picked.push(unique[start]!);
      if (pickedActionsConflict(picked, unique[start]!)) {
        picked.pop();
        return;
      }
      pickUnique(start + 1, picked);
      picked.pop();
    };
    pickUnique(0, []);
  }

  return best.actions;
}

function nearestPlan(
  actions: PlannerAction[],
  gap: number,
  mode: "nearest_under" | "nearest_over",
): PlannerAction[] {
  const { unique, repeatable } = partitionPlannerActions(actions);
  let best: PlannerAction[] = [];
  let bestDelta = Infinity;

  const consider = (picked: PlannerAction[]) => {
    const total = planScore(picked).totalPoints;
    if (mode === "nearest_under" && total > gap) return;
    if (mode === "nearest_over" && total < gap) return;
    const delta = Math.abs(gap - total);
    if (
      delta < bestDelta ||
      (delta === bestDelta && comparePlans(best, picked) > 0)
    ) {
      bestDelta = delta;
      best = picked;
    }
  };

  const walk = (start: number, picked: PlannerAction[], sum: number) => {
    consider(picked);
    if (picked.length >= MAX_UNIQUE_COMBO_SIZE || start >= unique.length) {
      return;
    }
    for (let i = start; i < unique.length; i++) {
      const action = unique[i]!;
      if (mode === "nearest_under" && sum + action.vsPoints > gap * 1.5) {
        continue;
      }
      if (pickedActionsConflict(picked, action)) continue;
      picked.push(action);
      walk(i + 1, picked, sum + action.vsPoints);
      picked.pop();
    }
  };
  walk(0, [], 0);

  if (best.length === 0 && repeatable.length > 0) {
    const pack = repeatable.find((a) => a.kind === "diamond_pack");
    if (pack) consider([pack]);
  }

  return best;
}

export function solveHeroDayPlanner(
  input: HeroDayPlannerInput,
  mode: HeroDayPlannerMode = "exact",
): HeroDayPlan | null {
  const gap = input.targetScore - input.currentScore;
  if (gap <= 0) return null;

  const actions = buildHeroDayActions(input);
  const { unique, repeatable } = partitionPlannerActions(actions);

  let picked: PlannerAction[] | null = null;
  if (mode === "exact") {
    picked = solveExact(unique, repeatable, gap);
  } else {
    picked = nearestPlan(actions, gap, mode);
  }

  if (picked == null || picked.length === 0) return null;

  const scored = planScore(picked);
  return {
    actions: picked,
    totalPoints: scored.totalPoints,
    projectedScore: input.currentScore + scored.totalPoints,
    mode,
    gapPoints: gap,
    diamondPacksPurchased: scored.diamondPacks,
    totalDiamondsPurchased: scored.diamondsPurchased,
  };
}

export function formatPlannerActionLabel(
  action: PlannerAction,
  translate: (key: string, values?: Record<string, string | number>) => string,
): string {
  return translate(action.labelKey, action.labelValues);
}
