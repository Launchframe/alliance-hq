import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";

/** LastRank's own catalog id — not a Last War game UID. */
export type LastRankAllianceMember = {
  publicId: number;
  name: string;
  country: string | null;
  power: number | null;
  heroPower: number | null;
  allianceRank: number | null;
  baseLevel: number | null;
  originServerId: number | null;
};

export type LastRankAlliancePage = {
  lastrankAllianceId: string;
  members: LastRankAllianceMember[];
};

export type LastRankHqRosterRow = {
  commanderId: string;
  ashedMemberId: string;
  names: string[];
  hqThp: number | null;
  hqLevel: number | null;
  hqPowerLevel: string | null;
};

export type LastRankMatchStatus =
  | "matched"
  | "unmatched"
  | "ambiguous"
  | "former_skipped";

export type LastRankMatchedRow = {
  status: "matched";
  lastRank: LastRankAllianceMember;
  hq: LastRankHqRosterRow;
};

export type LastRankUnmatchedRow = {
  status: "unmatched" | "ambiguous";
  lastRank: LastRankAllianceMember;
  hqCommanderIds: string[];
};

export type LastRankMatchResult = {
  matched: LastRankMatchedRow[];
  unmatched: LastRankUnmatchedRow[];
  unmatchedHq: LastRankHqRosterRow[];
};

const LASTRANK_ALLIANCE_ID_RE = /^[a-f0-9]{32}$/i;

export function isLastRankAllianceId(value: string): boolean {
  return LASTRANK_ALLIANCE_ID_RE.test(value.trim());
}

export function lastRankAllianceUrl(lastrankAllianceId: string): string {
  return `https://lastrank.fun/a/${lastrankAllianceId.trim().toLowerCase()}`;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseRawMember(raw: unknown): LastRankAllianceMember | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const publicId = asFiniteNumber(row.public_id);
  if (!name || publicId == null) return null;
  return {
    publicId: Math.round(publicId),
    name,
    country: typeof row.country === "string" ? row.country : null,
    power: asFiniteNumber(row.power),
    heroPower: asFiniteNumber(row.hero_power),
    allianceRank: asFiniteNumber(row.alliance_rank),
    baseLevel: asFiniteNumber(row.base_level),
    originServerId: asFiniteNumber(row.origin_server_id),
  };
}

function walkForMembers(node: unknown, depth = 0): LastRankAllianceMember[] | null {
  if (depth > 40 || node == null) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = walkForMembers(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  if (Array.isArray(rec.members) && rec.members.length > 0) {
    const parsed = rec.members
      .map(parseRawMember)
      .filter((row): row is LastRankAllianceMember => row != null);
    if (parsed.length > 0 && parsed[0].heroPower != null) {
      return parsed;
    }
  }
  for (const value of Object.values(rec)) {
    const found = walkForMembers(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJsonValueAt(source: string, start: number): unknown {
  if (source[start] !== "[") {
    throw new SyntaxError("expected array");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(start, i + 1));
      }
    }
  }
  throw new SyntaxError("unterminated JSON array");
}

function decodeNextFlightPush(rawArgs: unknown): unknown {
  if (!Array.isArray(rawArgs) || rawArgs.length < 2) return rawArgs;
  const payload = rawArgs[1];
  if (typeof payload !== "string") return rawArgs;
  const colon = payload.indexOf(":");
  const jsonPart = colon >= 0 ? payload.slice(colon + 1) : payload;
  try {
    return JSON.parse(jsonPart);
  } catch {
    return rawArgs;
  }
}

export function parseLastRankAllianceHtml(
  html: string,
  lastrankAllianceId: string,
): LastRankAlliancePage {
  if (
    html.includes("cf-mitigated") ||
    html.includes("Just a moment") ||
    html.includes("challenge-platform")
  ) {
    throw new Error("LastRank returned a Cloudflare challenge page");
  }

  const marker = "self.__next_f.push(";
  let from = 0;
  while (from < html.length) {
    const idx = html.indexOf(marker, from);
    if (idx < 0) break;
    const jsonStart = idx + marker.length;
    if (html[jsonStart] !== "[") {
      from = jsonStart;
      continue;
    }
    try {
      const rawArgs = parseJsonValueAt(html, jsonStart);
      const tree = decodeNextFlightPush(rawArgs);
      const members = walkForMembers(tree);
      if (members && members.length > 0) {
        return {
          lastrankAllianceId: lastrankAllianceId.trim().toLowerCase(),
          members,
        };
      }
    } catch {
      // try the next flight chunk
    }
    from = jsonStart + 1;
  }

  throw new Error("LastRank HTML did not contain alliance member stats");
}

export function formatLastRankPowerLevel(power: number | null): string | null {
  if (power == null || !Number.isFinite(power) || power <= 0) return null;
  const millions = power / 1_000_000;
  const decimals = millions >= 10 ? 1 : 2;
  const factor = 10 ** decimals;
  const rounded = Math.round(millions * factor) / factor;
  return `${rounded}M`;
}

export function matchLastRankMembersToHq(
  lastRankMembers: LastRankAllianceMember[],
  hqRows: LastRankHqRosterRow[],
): LastRankMatchResult {
  const byName = new Map<string, LastRankHqRosterRow[]>();
  for (const hq of hqRows) {
    const seen = new Set<string>();
    for (const name of hq.names) {
      const key = normalizeCommanderName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const list = byName.get(key) ?? [];
      list.push(hq);
      byName.set(key, list);
    }
  }

  const matchedHqIds = new Set<string>();
  const matched: LastRankMatchedRow[] = [];
  const unmatched: LastRankUnmatchedRow[] = [];

  for (const lastRank of lastRankMembers) {
    const key = normalizeCommanderName(lastRank.name);
    const hits = byName.get(key) ?? [];
    const unique = [
      ...new Map(hits.map((row) => [row.commanderId, row])).values(),
    ];
    if (unique.length === 1) {
      matchedHqIds.add(unique[0].commanderId);
      matched.push({ status: "matched", lastRank, hq: unique[0] });
    } else if (unique.length === 0) {
      unmatched.push({ status: "unmatched", lastRank, hqCommanderIds: [] });
    } else {
      unmatched.push({
        status: "ambiguous",
        lastRank,
        hqCommanderIds: unique.map((row) => row.commanderId),
      });
    }
  }

  return {
    matched,
    unmatched,
    unmatchedHq: hqRows.filter((row) => !matchedHqIds.has(row.commanderId)),
  };
}

export function parseLastRankSyncMap(
  raw: string | undefined,
): Array<{ tag: string; lastrankAllianceId: string }> {
  if (!raw?.trim()) return [];
  const out: Array<{ tag: string; lastrankAllianceId: string }> = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(
        `Invalid LASTRANK_SYNC_MAP entry "${trimmed}" (expected TAG=32charHex)`,
      );
    }
    const tag = trimmed.slice(0, eq).trim();
    const lastrankAllianceId = trimmed.slice(eq + 1).trim().toLowerCase();
    if (!tag || !isLastRankAllianceId(lastrankAllianceId)) {
      throw new Error(
        `Invalid LASTRANK_SYNC_MAP entry "${trimmed}" (expected TAG=32charHex)`,
      );
    }
    out.push({ tag, lastrankAllianceId });
  }
  return out;
}
