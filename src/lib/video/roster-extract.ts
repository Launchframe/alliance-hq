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

const POWER_SUFFIX_RE = /^(\d+(?:\.\d+)?)\s*([KMB])\b/i;
const POWER_EMBEDDED_M_RE = /(\d+(?:\.\d+)?)\s*M\b/i;

function formatPowerLevelDisplay(millions: number): string {
  const decimals = millions >= 10 ? 1 : 2;
  const factor = 10 ** decimals;
  const rounded = Math.round(millions * factor) / factor;
  return `${rounded}M`;
}

export function parsePowerLevelString(
  value: string | undefined | null,
): { powerLevel: string | null; heroPowerM: number | null } {
  if (!value?.trim() || isJunkOcrString(value)) {
    return { powerLevel: null, heroPowerM: null };
  }
  const trimmed = value.trim().replace(/,/g, "");

  const suffixMatch = POWER_SUFFIX_RE.exec(trimmed);
  if (suffixMatch) {
    const amount = parseFloat(suffixMatch[1]!);
    const suffix = suffixMatch[2]!.toUpperCase();
    if (!Number.isFinite(amount) || amount < 0) {
      return { powerLevel: null, heroPowerM: null };
    }
    const millions =
      suffix === "B" ? amount * 1000 : suffix === "K" ? amount / 1000 : amount;
    const heroPowerM = Number(millions.toPrecision(12));
    return {
      powerLevel: formatPowerLevelDisplay(heroPowerM),
      heroPowerM,
    };
  }

  const embeddedM = POWER_EMBEDDED_M_RE.exec(trimmed);
  if (embeddedM) {
    const heroPowerM = parseFloat(embeddedM[1]!);
    if (!Number.isFinite(heroPowerM)) {
      return { powerLevel: null, heroPowerM: null };
    }
    return {
      powerLevel: formatPowerLevelDisplay(heroPowerM),
      heroPowerM,
    };
  }

  // Strength Ranking → Power often returns the raw integer (e.g. "297494218").
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const raw = Number(trimmed);
    if (!Number.isFinite(raw) || raw <= 0) {
      return { powerLevel: null, heroPowerM: null };
    }
    if (raw >= 1_000_000) {
      const millions = raw / 1_000_000;
      return {
        powerLevel: formatPowerLevelDisplay(millions),
        heroPowerM: millions,
      };
    }
    // Already in millions (e.g. "297.5") — common when OCR drops the suffix.
    if (raw < 10_000) {
      return {
        powerLevel: formatPowerLevelDisplay(raw),
        heroPowerM: raw,
      };
    }
  }

  return { powerLevel: null, heroPowerM: null };
}

function normalizeMemberLevel(value: unknown): number | null {
  if (typeof value === "string" && isJunkOcrString(value)) return null;
  return normalizeMemberHqLevel(value);
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
  } else if (typeof row.power === "string" && !isJunkOcrString(row.power)) {
    powerLevel = row.power;
  } else if (typeof row.power_level === "number" && Number.isFinite(row.power_level)) {
    powerLevel = String(row.power_level);
  } else if (typeof row.power === "number" && Number.isFinite(row.power)) {
    powerLevel = String(row.power);
  }

  return {
    current_name: name,
    rank: rankRaw,
    power_level: powerLevel,
    // Strength Ranking → Power does not show HQ levels; Ashed often hallucinates
    // them. Never trust OCR level for roster video — keep existing HQ levels.
    level: undefined,
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
    memberLevel: null,
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
