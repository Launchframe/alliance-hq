import { parseAshedAllianceRankRaw } from "@/lib/members/alliance-rank";
import type {
  AshedMemberRecord,
  RosterVideoOcrMember,
} from "@/lib/members/ashed-member-record";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";
import { unwrapOcrPayload } from "@/lib/video/normalize-rows";

export type ExtractedRosterMember = {
  currentName: string;
  rosterRankRaw: string | null;
  allianceRank: number | null;
  allianceRankTitle: string | null;
  powerLevel: string | null;
  heroPowerM: number | null;
  memberLevel: number | null;
  profession: string | null;
  status: string | null;
  _sourceFrameIndex?: number;
};

const POWER_RE = /(\d+(?:\.\d+)?)\s*M\b/i;

const JUNK_OCR_STRINGS = new Set([
  "",
  "null",
  "undefined",
  "n/a",
  "member",
  "none",
]);

function isJunkOcrString(value: string): boolean {
  return JUNK_OCR_STRINGS.has(value.trim().toLowerCase());
}

/** Rank-only parse for roster video — titles from OCR are ignored. */
export function parseRosterVideoAllianceRank(
  raw: unknown,
): { allianceRank: number | null; rosterRankRaw: string | null } {
  if (raw == null) {
    return { allianceRank: null, rosterRankRaw: null };
  }

  if (typeof raw === "string" && isJunkOcrString(raw)) {
    return { allianceRank: null, rosterRankRaw: null };
  }

  const parsed = parseAshedAllianceRankRaw(raw);
  if (parsed.rank == null || parsed.rank < 1 || parsed.rank > 5) {
    return { allianceRank: null, rosterRankRaw: null };
  }

  return {
    allianceRank: parsed.rank,
    rosterRankRaw: `R${parsed.rank}`,
  };
}

export function parsePowerLevelString(
  value: string | undefined | null,
): { powerLevel: string | null; heroPowerM: number | null } {
  if (!value?.trim() || isJunkOcrString(value)) {
    return { powerLevel: null, heroPowerM: null };
  }
  const trimmed = value.trim();
  const match = POWER_RE.exec(trimmed);
  if (match) {
    const heroPowerM = parseFloat(match[1]!);
    if (!Number.isFinite(heroPowerM)) {
      return { powerLevel: null, heroPowerM: null };
    }
    return {
      powerLevel: trimmed,
      heroPowerM,
    };
  }
  return { powerLevel: null, heroPowerM: null };
}

function normalizeMemberLevel(value: unknown): number | null {
  if (typeof value === "string" && isJunkOcrString(value)) return null;
  return normalizeMemberHqLevel(value);
}

function parseOcrLevel(value: unknown): number | undefined {
  const normalized = normalizeMemberLevel(value);
  return normalized ?? undefined;
}

function normalizeOcrMember(raw: unknown): RosterVideoOcrMember | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name =
    typeof row.current_name === "string"
      ? row.current_name.trim()
      : typeof row.name === "string"
        ? row.name.trim()
        : "";
  if (!name) return null;

  let rankRaw: string | undefined;
  if (typeof row.rank === "string") {
    rankRaw = isJunkOcrString(row.rank) ? undefined : row.rank;
  } else if (typeof row.rank === "number" && row.rank >= 1 && row.rank <= 5) {
    rankRaw = `R${row.rank}`;
  }

  let powerLevel: string | undefined;
  if (typeof row.power_level === "string" && !isJunkOcrString(row.power_level)) {
    powerLevel = row.power_level;
  }

  return {
    current_name: name,
    rank: rankRaw,
    power_level: powerLevel,
    level: parseOcrLevel(row.level),
    status: typeof row.status === "string" ? row.status : undefined,
  };
}

export function extractRosterMembers(payload: unknown): RosterVideoOcrMember[] {
  const root = unwrapOcrPayload(payload);
  if (!root) return [];

  const membersRaw = root.members ?? root.entries ?? root.players;
  if (!Array.isArray(membersRaw)) return [];

  const out: RosterVideoOcrMember[] = [];
  for (const item of membersRaw) {
    const normalized = normalizeOcrMember(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function rosterOcrMemberToExtracted(
  member: RosterVideoOcrMember,
  sourceFrameIndex?: number,
): ExtractedRosterMember {
  const { allianceRank, rosterRankRaw } = parseRosterVideoAllianceRank(
    member.rank ?? null,
  );
  const { powerLevel, heroPowerM } = parsePowerLevelString(member.power_level);

  return {
    currentName: member.current_name.trim(),
    rosterRankRaw,
    allianceRank,
    allianceRankTitle: null,
    powerLevel,
    heroPowerM,
    memberLevel: normalizeMemberLevel(member.level),
    profession: null,
    status: member.status?.trim() || null,
    _sourceFrameIndex: sourceFrameIndex,
  };
}

function rosterMemberKey(row: ExtractedRosterMember): string {
  return row.currentName.trim().toLowerCase();
}

function completenessScore(row: ExtractedRosterMember): number {
  let score = 0;
  if (row.heroPowerM != null) score += 2;
  if (row.memberLevel != null) score += 2;
  if (row.allianceRank != null) score += 1;
  return score;
}

/** Dedupe roster rows across frames by name; prefer richer rows on conflict. */
export function collapseRosterMembersByNameRank(
  rows: ExtractedRosterMember[],
): ExtractedRosterMember[] {
  const byKey = new Map<string, ExtractedRosterMember>();

  for (const row of rows) {
    const key = rosterMemberKey(row);
    const existing = byKey.get(key);
    if (!existing || completenessScore(row) > completenessScore(existing)) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const rankA = a.allianceRank ?? 99;
    const rankB = b.allianceRank ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.currentName.localeCompare(b.currentName);
  });
}

export function ashedMemberRecordToExtracted(
  record: AshedMemberRecord,
): ExtractedRosterMember {
  const { allianceRank, rosterRankRaw } = parseRosterVideoAllianceRank(
    record.rank ?? null,
  );
  const { powerLevel, heroPowerM } = parsePowerLevelString(
    record.power_level ?? null,
  );

  return {
    currentName: record.current_name,
    rosterRankRaw,
    allianceRank,
    allianceRankTitle: null,
    powerLevel,
    heroPowerM,
    memberLevel: normalizeMemberLevel(record.level),
    profession: null,
    status: record.status ?? null,
  };
}
