import { normalizeName } from "@/lib/vr/link-helpers";

export type VrChartCommanderCandidate = {
  commanderId: string;
  memberName: string;
};

export type ResolveVrChartCommanderNamesResult = {
  commanderIds: string[];
  notFound: string[];
  ambiguous: Array<{ query: string; memberNames: string[] }>;
};

function matchesCommanderName(query: string, memberName: string): boolean {
  return normalizeName(query) === normalizeName(memberName);
}

/**
 * Resolve user-supplied commander names against alliance members with VR history.
 * Exact name match only (case/whitespace insensitive).
 */
export function resolveVrChartCommanderNames(
  names: string[],
  candidates: VrChartCommanderCandidate[],
): ResolveVrChartCommanderNamesResult {
  const commanderIds: string[] = [];
  const notFound: string[] = [];
  const ambiguous: Array<{ query: string; memberNames: string[] }> = [];

  for (const rawName of names) {
    const query = rawName.trim();
    if (!query) continue;

    const matches = candidates.filter((row) =>
      matchesCommanderName(query, row.memberName),
    );
    if (matches.length === 0) {
      notFound.push(query);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({
        query,
        memberNames: matches.map((row) => row.memberName),
      });
      continue;
    }
    const commanderId = matches[0]!.commanderId;
    if (!commanderIds.includes(commanderId)) {
      commanderIds.push(commanderId);
    }
  }

  return { commanderIds, notFound, ambiguous };
}

/** Split comma/semicolon-separated commander tokens from a slash option value. */
export function expandVrChartCommanderNameInputs(names: string[]): string[] {
  return names.flatMap((name) =>
    name
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}
