/**
 * Officer team-builder draft: ratio, engineer-only rank balance, paste export.
 * Safe to import from client components.
 */

export type TeamBuilderRankKey = "1" | "2" | "3" | "4" | "5" | "unknown";

export const TEAM_BUILDER_RANK_KEYS: readonly TeamBuilderRankKey[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "unknown",
];

export type TeamBuilderPerson = {
  commanderId: string;
  name: string;
  /** In-game rank 1–5. Null is its own share. War Leader rank is ignored. */
  rank: number | null;
};

export type TeamBuilderDraftTeam = {
  wl: TeamBuilderPerson;
  engineers: TeamBuilderPerson[];
  /** Seats this team should hold before the officer edits. */
  size: number;
  /** Hamilton target for each engineer rank bucket, including unknown. */
  rankTargets: Record<TeamBuilderRankKey, number>;
};

export type TeamBuilderDraft = {
  teams: TeamBuilderDraftTeam[];
  unplaced: TeamBuilderPerson[];
};

export type TeamBuilderRatio =
  | { ok: false; reason: "no_war_leader" }
  | {
      ok: true;
      warLeaders: number;
      engineers: number;
      /** floor(engineers / warLeaders) */
      base: number;
      /** engineers % warLeaders teams get one more when the target stays at base. */
      extra: number;
    };

export function teamBuilderDisplayName(input: {
  memberName: string | null;
  primaryName: string | null;
}): string {
  const roster = input.memberName?.trim();
  if (roster) return roster;
  return input.primaryName?.trim() ?? "";
}

export function teamBuilderRankKey(rank: number | null): TeamBuilderRankKey {
  if (rank === 1 || rank === 2 || rank === 3 || rank === 4 || rank === 5) {
    return String(rank) as TeamBuilderRankKey;
  }
  return "unknown";
}

export function suggestEngineerRatio(
  warLeaderCount: number,
  engineerCount: number,
): TeamBuilderRatio {
  if (warLeaderCount <= 0) return { ok: false, reason: "no_war_leader" };
  const engineers = Math.max(0, engineerCount);
  return {
    ok: true,
    warLeaders: warLeaderCount,
    engineers,
    base: Math.floor(engineers / warLeaderCount),
    extra: engineers % warLeaderCount,
  };
}

function comparePeople(a: TeamBuilderPerson, b: TeamBuilderPerson): number {
  const byName = a.name.localeCompare(b.name, "en");
  if (byName !== 0) return byName;
  return a.commanderId.localeCompare(b.commanderId);
}

function emptyTargets(): Record<TeamBuilderRankKey, number> {
  return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, unknown: 0 };
}

/** Seat counts. When `target` is the suggested base, remainder teams get one extra. */
export function teamTargetSizes(
  warLeaderCount: number,
  engineerCount: number,
  target: number,
): { sizes: number[]; unplacedCount: number } {
  if (warLeaderCount <= 0) {
    return { sizes: [], unplacedCount: Math.max(0, engineerCount) };
  }
  const engineers = Math.max(0, engineerCount);
  const cap = Math.max(0, Math.floor(target));
  const suggestedBase = Math.floor(engineers / warLeaderCount);
  if (cap === suggestedBase) {
    const extra = engineers % warLeaderCount;
    return {
      sizes: Array.from(
        { length: warLeaderCount },
        (_, index) => suggestedBase + (index < extra ? 1 : 0),
      ),
      unplacedCount: 0,
    };
  }
  if (cap < suggestedBase) {
    return {
      sizes: Array.from({ length: warLeaderCount }, () => cap),
      unplacedCount: engineers - cap * warLeaderCount,
    };
  }
  const evenBase = Math.floor(engineers / warLeaderCount);
  const evenExtra = engineers % warLeaderCount;
  return {
    sizes: Array.from(
      { length: warLeaderCount },
      (_, index) => evenBase + (index < evenExtra ? 1 : 0),
    ),
    unplacedCount: 0,
  };
}

function hamilton(count: number, weights: number[]): number[] {
  if (weights.length === 0 || count <= 0) return weights.map(() => 0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return weights.map(() => 0);
  const floors = weights.map((weight) => Math.floor((count * weight) / total));
  let remaining = count - floors.reduce((sum, value) => sum + value, 0);
  const order = weights
    .map((weight, index) => ({
      index,
      frac: (count * weight) / total - Math.floor((count * weight) / total),
    }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  const seats = [...floors];
  for (const entry of order) {
    if (remaining <= 0) break;
    seats[entry.index] = (seats[entry.index] ?? 0) + 1;
    remaining -= 1;
  }
  return seats;
}

function countBucket(
  people: TeamBuilderPerson[],
  key: TeamBuilderRankKey,
): number {
  return people.filter((person) => teamBuilderRankKey(person.rank) === key).length;
}

function repairSeatCounts(
  groups: TeamBuilderPerson[][],
  sizes: number[],
  quotas: Record<TeamBuilderRankKey, number[]>,
): void {
  const limit = groups.reduce((sum, group) => sum + group.length, 0) + 1;
  for (let step = 0; step < limit; step += 1) {
    let overIndex = -1;
    let overSurplus = 0;
    let shortIndex = -1;
    let shortDeficit = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const delta = (groups[index]?.length ?? 0) - (sizes[index] ?? 0);
      if (delta > overSurplus) {
        overSurplus = delta;
        overIndex = index;
      }
      if (-delta > shortDeficit) {
        shortDeficit = -delta;
        shortIndex = index;
      }
    }
    if (overIndex < 0 || shortIndex < 0) return;

    const source = groups[overIndex] ?? [];
    let bucket: TeamBuilderRankKey = "unknown";
    let bucketOver = Number.NEGATIVE_INFINITY;
    for (const key of TEAM_BUILDER_RANK_KEYS) {
      const over =
        countBucket(source, key) - (quotas[key]?.[overIndex] ?? 0);
      if (over > bucketOver) {
        bucketOver = over;
        bucket = key;
      }
    }
    const candidates = source
      .filter((person) => teamBuilderRankKey(person.rank) === bucket)
      .sort(comparePeople);
    const moving = candidates[candidates.length - 1];
    if (!moving) return;
    groups[overIndex] = source.filter(
      (person) => person.commanderId !== moving.commanderId,
    );
    groups[shortIndex] = [...(groups[shortIndex] ?? []), moving].sort(comparePeople);
  }
}

export function buildTeamDraft(input: {
  warLeaders: TeamBuilderPerson[];
  engineers: TeamBuilderPerson[];
  /** Engineers per War Leader. Defaults to the suggested base at the call site. */
  target: number;
}): TeamBuilderDraft {
  const warLeaders = [...input.warLeaders].sort(comparePeople);
  const engineers = [...input.engineers].sort(comparePeople);
  const { sizes, unplacedCount } = teamTargetSizes(
    warLeaders.length,
    engineers.length,
    input.target,
  );
  const weights = unplacedCount > 0 ? [...sizes, unplacedCount] : [...sizes];
  const quotas = emptyQuotaLists(weights.length);
  const byBucket = new Map<TeamBuilderRankKey, TeamBuilderPerson[]>();
  for (const engineer of engineers) {
    const key = teamBuilderRankKey(engineer.rank);
    const list = byBucket.get(key) ?? [];
    list.push(engineer);
    byBucket.set(key, list);
  }

  const groups: TeamBuilderPerson[][] = weights.map(() => []);
  for (const key of TEAM_BUILDER_RANK_KEYS) {
    const people = byBucket.get(key) ?? [];
    const seats = hamilton(people.length, weights);
    quotas[key] = seats;
    let cursor = 0;
    for (let index = 0; index < weights.length; index += 1) {
      const count = seats[index] ?? 0;
      for (let n = 0; n < count; n += 1) {
        const person = people[cursor];
        cursor += 1;
        if (person) groups[index]?.push(person);
      }
    }
  }

  repairSeatCounts(groups, weights, quotas);

  const teams: TeamBuilderDraftTeam[] = warLeaders.map((wl, index) => {
    const rankTargets = emptyTargets();
    for (const key of TEAM_BUILDER_RANK_KEYS) {
      rankTargets[key] = quotas[key]?.[index] ?? 0;
    }
    return {
      wl,
      engineers: groups[index] ?? [],
      size: sizes[index] ?? 0,
      rankTargets,
    };
  });
  const unplaced =
    unplacedCount > 0 ? (groups[groups.length - 1] ?? []) : [];
  return { teams, unplaced };
}

function emptyQuotaLists(
  teamCount: number,
): Record<TeamBuilderRankKey, number[]> {
  return {
    "1": Array.from({ length: teamCount }, () => 0),
    "2": Array.from({ length: teamCount }, () => 0),
    "3": Array.from({ length: teamCount }, () => 0),
    "4": Array.from({ length: teamCount }, () => 0),
    "5": Array.from({ length: teamCount }, () => 0),
    unknown: Array.from({ length: teamCount }, () => 0),
  };
}

export function countEngineerRanks(
  engineers: TeamBuilderPerson[],
): Record<TeamBuilderRankKey, number> {
  const counts = emptyTargets();
  for (const engineer of engineers) {
    counts[teamBuilderRankKey(engineer.rank)] += 1;
  }
  return counts;
}

/** Canonical paste-import lines. Teams with no Engineers are omitted. */
export function formatPairingExport(
  teams: { wlName: string; engineerNames: string[] }[],
): string {
  return teams
    .map((team) => ({
      wlName: team.wlName.trim(),
      engineerNames: team.engineerNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .sort((a, b) => a.localeCompare(b, "en")),
    }))
    .filter((team) => team.wlName.length > 0 && team.engineerNames.length > 0)
    .sort((a, b) => a.wlName.localeCompare(b.wlName, "en"))
    .map((team) => `${team.wlName}: ${team.engineerNames.join(" ")}`)
    .join("\n");
}
