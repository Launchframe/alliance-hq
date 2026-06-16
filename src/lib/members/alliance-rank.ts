/** Official R4 officer titles in Ashed (vanilla R4 has no title). */
export const ASHED_R4_OFFICER_TITLES = [
  "Muse",
  "Butler",
  "Recruiter",
  "Warlord",
] as const;

export type ParsedAshedAllianceRank = {
  rank: number | null;
  /** Officer title when Ashed stores it in Member.rank (e.g. Muse, Warlord). */
  title: string | null;
};

const ASHED_R4_TITLE_BY_LOWER = new Map<string, string>(
  ASHED_R4_OFFICER_TITLES.map((title) => [title.toLowerCase(), title]),
);

/** R5 leader label when Ashed stores it bare in Member.rank. */
export const ASHED_R5_LEADER_TITLE = "Leader";

function normalizeAllianceRankTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

function parseKnownBareAllianceTitle(
  trimmed: string,
): ParsedAshedAllianceRank | null {
  const r4Title = ASHED_R4_TITLE_BY_LOWER.get(trimmed.toLowerCase());
  if (r4Title) {
    return { rank: 4, title: r4Title };
  }

  if (trimmed.toLowerCase() === ASHED_R5_LEADER_TITLE.toLowerCase()) {
    return { rank: 5, title: ASHED_R5_LEADER_TITLE };
  }

  return null;
}

/** Parse a raw Ashed rank value (number or string) into rank + optional title. */
export function parseAshedAllianceRankRaw(
  raw: unknown,
): ParsedAshedAllianceRank {
  if (typeof raw === "number" && raw >= 1 && raw <= 5) {
    return { rank: raw, title: null };
  }

  if (typeof raw !== "string") {
    return { rank: null, title: null };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { rank: null, title: null };
  }

  // Muse (R4), Butler (R4), …
  const titleBeforeRank = /^(.+?)\s*\(R([1-5])\)$/i.exec(trimmed);
  if (titleBeforeRank) {
    return {
      rank: Number.parseInt(titleBeforeRank[2], 10),
      title: normalizeAllianceRankTitle(titleBeforeRank[1]),
    };
  }

  // R5 (Leader)
  const titleAfterRank = /^R([1-5])\s*\(([^)]+)\)$/i.exec(trimmed);
  if (titleAfterRank) {
    return {
      rank: Number.parseInt(titleAfterRank[1], 10),
      title: normalizeAllianceRankTitle(titleAfterRank[2]),
    };
  }

  const plainRank = /^R([1-5])$/i.exec(trimmed);
  if (plainRank) {
    return {
      rank: Number.parseInt(plainRank[1], 10),
      title: null,
    };
  }

  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    if (parsed >= 1 && parsed <= 5) {
      return { rank: parsed, title: null };
    }
  }

  // Ashed API: rank is the bare officer title (Warlord, Muse, …) for titled R4s.
  const bareTitle = parseKnownBareAllianceTitle(trimmed);
  if (bareTitle) {
    return bareTitle;
  }

  return { rank: null, title: null };
}

function readRawAllianceRankValue(member: Record<string, unknown>): unknown {
  return (
    member.alliance_rank ??
    member.allianceRank ??
    member.rank ??
    member.member_rank
  );
}

/** Read in-game alliance rank (1–5) and optional title from an Ashed Member payload. */
export function parseAshedMemberAllianceRank(
  member: Record<string, unknown>,
): ParsedAshedAllianceRank {
  const parsed = parseAshedAllianceRankRaw(readRawAllianceRankValue(member));
  const explicitTitle = member.alliance_rank_title ?? member.allianceRankTitle;
  if (
    parsed.title == null &&
    typeof explicitTitle === "string" &&
    explicitTitle.trim()
  ) {
    return { ...parsed, title: normalizeAllianceRankTitle(explicitTitle) };
  }
  return parsed;
}

/** Rank only — pool eligibility and legacy callers. */
export function readAshedMemberAllianceRank(
  member: Record<string, unknown>,
): number | null {
  return parseAshedMemberAllianceRank(member).rank;
}

export function isAshedMemberUnranked(member: Record<string, unknown>): boolean {
  return readAshedMemberAllianceRank(member) == null;
}

export function formatAllianceRankLabel(rank: number | null): string | null {
  if (rank == null) return null;
  return `R${rank}`;
}

/** Serialize rank + title back to Ashed Member.rank string format. */
export function formatAshedMemberRankValue(
  rank: number,
  title?: string | null,
): string {
  const normalized = title?.trim() ? normalizeAllianceRankTitle(title) : null;
  if (rank === 4 && normalized) {
    return ASHED_R4_TITLE_BY_LOWER.get(normalized.toLowerCase()) ?? normalized;
  }
  if (
    rank === 5 &&
    normalized?.toLowerCase() === ASHED_R5_LEADER_TITLE.toLowerCase()
  ) {
    return ASHED_R5_LEADER_TITLE;
  }
  return `R${rank}`;
}

export function formatMemberRankDisplay(
  parsed: ParsedAshedAllianceRank,
  unknownLabel: string,
): { rankLabel: string; titleLabel: string } {
  return {
    rankLabel: formatAllianceRankLabel(parsed.rank) ?? unknownLabel,
    titleLabel: parsed.title ?? unknownLabel,
  };
}
