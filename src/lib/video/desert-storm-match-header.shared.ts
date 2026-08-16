/**
 * Desert Storm battle-results header (first-frame OCR) → opponent + outcome.
 *
 * In-game mail shows two alliance cards: `#server`, name, and flag total.
 * Tag is not on that header. Incomplete or ambiguous parses junk *all*
 * prefill so officers start from blank Pending fields.
 */

export const DESERT_STORM_MATCH_OUTCOMES = ["pending", "win", "loss"] as const;
export type DesertStormMatchOutcome =
  (typeof DESERT_STORM_MATCH_OUTCOMES)[number];

export type DesertStormMatchHeader = {
  outcome: DesertStormMatchOutcome;
  opponentServer: string;
  opponentTag: string;
  opponentName: string;
  oursTotal: number | null;
  theirsTotal: number | null;
  filledFromOcr: boolean;
};

export type DesertStormAllianceIdentity = {
  gameServerNumber: number;
  name: string;
};

export type DesertStormStormTeam = "A" | "B";

const HEADER_STOP_RE =
  /battle\s*status|individual\s*points|highest\s*total|top\s*scorer|top\s*collector|\[\s*[A-Za-z0-9]{2,8}\s*\]/i;

const CARD_LINE_RE =
  /#(\d{3,5})\s+(.+?)\s+(\d{1,3}(?:,\d{3})+|\d{5,8})\s*$/;

const SERVER_TOKEN_RE = /#(\d{3,5})\b/g;
const COMMA_SCORE_RE = /\b(\d{1,3}(?:,\d{3})+)\b/g;

type MatchSide = {
  server: number;
  name: string;
  score: number;
};

export function isDesertStormMatchOutcome(
  value: unknown,
): value is DesertStormMatchOutcome {
  return (
    value === "pending" || value === "win" || value === "loss"
  );
}

export function blankDesertStormMatchHeader(): DesertStormMatchHeader {
  return {
    outcome: "pending",
    opponentServer: "",
    opponentTag: "",
    opponentName: "",
    oursTotal: null,
    theirsTotal: null,
    filledFromOcr: false,
  };
}

export function isDesertStormMatchHeader(
  value: unknown,
): value is DesertStormMatchHeader {
  if (!value || typeof value !== "object") return false;
  const row = value as DesertStormMatchHeader;
  return (
    isDesertStormMatchOutcome(row.outcome) &&
    typeof row.opponentServer === "string" &&
    typeof row.opponentTag === "string" &&
    typeof row.opponentName === "string" &&
    (row.oursTotal === null || typeof row.oursTotal === "number") &&
    (row.theirsTotal === null || typeof row.theirsTotal === "number") &&
    typeof row.filledFromOcr === "boolean"
  );
}

/** Read parseSessions.rawExtractJson.desertStormMatch when present. */
export function readDesertStormMatchFromRawExtract(
  rawExtractJson: unknown,
): DesertStormMatchHeader {
  if (!rawExtractJson || typeof rawExtractJson !== "object") {
    return blankDesertStormMatchHeader();
  }
  const candidate = (rawExtractJson as { desertStormMatch?: unknown })
    .desertStormMatch;
  return isDesertStormMatchHeader(candidate)
    ? candidate
    : blankDesertStormMatchHeader();
}

export function desertStormMatchHasOfficerInput(
  header: DesertStormMatchHeader,
): boolean {
  if (header.outcome !== "pending") return true;
  if (header.opponentServer.trim()) return true;
  if (header.opponentTag.trim()) return true;
  if (header.opponentName.trim()) return true;
  return false;
}

/**
 * Ashed DesertStormEvent.update payload for one internal team row.
 * Field names from ashed.online Event View (`team_a_result`, `team_a_opponent_*`).
 */
export function buildDesertStormMatchAshedPatch(
  team: DesertStormStormTeam,
  header: DesertStormMatchHeader,
): Record<string, unknown> {
  const prefix = team === "B" ? "team_b" : "team_a";
  const serverRaw = header.opponentServer.trim();
  const serverNum = serverRaw ? Number(serverRaw) : Number.NaN;
  return {
    [`${prefix}_result`]: header.outcome,
    [`${prefix}_opponent_server`]: Number.isFinite(serverNum)
      ? serverNum
      : null,
    [`${prefix}_opponent_tag`]: header.opponentTag.trim() || null,
    [`${prefix}_opponent_name`]: header.opponentName.trim() || null,
  };
}

export type DesertStormRowSumStatus = "ok" | "short" | "over";

export type DesertStormRowSumCheck = {
  status: DesertStormRowSumStatus;
  rowSum: number;
  teamTotal: number;
  delta: number;
};

function parseRowScoreForTeamTotal(
  score: string | number | null | undefined,
): number | null {
  if (typeof score === "number") {
    return Number.isFinite(score) ? score : null;
  }
  const parsed = Number.parseFloat(String(score ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compare active review-row scores to the home-team battle-results total.
 * Returns null when that total is not populated (incomplete first-frame OCR).
 */
export function compareDesertStormRowSumToTeamTotal(params: {
  teamTotal: number | null | undefined;
  scores: ReadonlyArray<string | number | null | undefined>;
}): DesertStormRowSumCheck | null {
  const teamTotal = params.teamTotal;
  if (teamTotal == null || !Number.isFinite(teamTotal) || teamTotal <= 0) {
    return null;
  }

  let rowSum = 0;
  for (const score of params.scores) {
    const parsed = parseRowScoreForTeamTotal(score);
    if (parsed != null) rowSum += parsed;
  }

  const delta = Math.abs(rowSum - teamTotal);
  let status: DesertStormRowSumStatus = "ok";
  if (rowSum < teamTotal) status = "short";
  else if (rowSum > teamTotal) status = "over";

  return { status, rowSum, teamTotal, delta };
}

export function parseDesertStormMatchSubmitFields(input: {
  matchOutcome?: unknown;
  opponentServer?: unknown;
  opponentTag?: unknown;
  opponentName?: unknown;
}): DesertStormMatchHeader {
  const outcome = isDesertStormMatchOutcome(input.matchOutcome)
    ? input.matchOutcome
    : "pending";
  const opponentServer =
    typeof input.opponentServer === "string" ? input.opponentServer : "";
  const opponentTag =
    typeof input.opponentTag === "string" ? input.opponentTag : "";
  const opponentName =
    typeof input.opponentName === "string" ? input.opponentName : "";
  return {
    outcome,
    opponentServer,
    opponentTag,
    opponentName,
    oursTotal: null,
    theirsTotal: null,
    filledFromOcr: false,
  };
}

export function parseDesertStormMatchHeaderLines(
  lines: string[],
  us: DesertStormAllianceIdentity,
): DesertStormMatchHeader {
  const headerLines = extractHeaderLines(lines);
  const sides =
    parseCardLines(headerLines) ??
    parseSequentialBlocks(headerLines) ??
    parseColumnZip(headerLines, us);

  if (!sides || sides.length !== 2) {
    return blankDesertStormMatchHeader();
  }

  const [left, right] = sides;
  if (!isCompleteSide(left) || !isCompleteSide(right)) {
    return blankDesertStormMatchHeader();
  }
  if (left.server === right.server) {
    return blankDesertStormMatchHeader();
  }

  const oursIndex = pickOursIndex(sides, us);
  if (oursIndex == null) {
    return blankDesertStormMatchHeader();
  }

  const ours = sides[oursIndex]!;
  const theirs = sides[1 - oursIndex]!;
  if (!theirs.name.trim()) {
    return blankDesertStormMatchHeader();
  }

  let outcome: DesertStormMatchOutcome = "pending";
  if (ours.score > theirs.score) outcome = "win";
  else if (ours.score < theirs.score) outcome = "loss";

  return {
    outcome,
    opponentServer: String(theirs.server),
    opponentTag: "",
    opponentName: theirs.name.trim(),
    oursTotal: ours.score,
    theirsTotal: theirs.score,
    filledFromOcr: true,
  };
}

function extractHeaderLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (HEADER_STOP_RE.test(line)) break;
    out.push(line);
    if (out.length >= 24) break;
  }
  return out;
}

function parseScoreToken(raw: string): number | null {
  const cleaned = raw.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const value = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(value) || value < 10_000) return null;
  return value;
}

function isCompleteSide(side: MatchSide | undefined): side is MatchSide {
  return Boolean(
    side &&
      side.server >= 100 &&
      side.server <= 99_999 &&
      side.name.trim().length >= 2 &&
      side.score >= 10_000,
  );
}

function parseCardLines(lines: string[]): MatchSide[] | null {
  const sides: MatchSide[] = [];
  for (const line of lines) {
    const match = CARD_LINE_RE.exec(line);
    if (!match) continue;
    const server = Number.parseInt(match[1]!, 10);
    const name = match[2]!.trim();
    const score = parseScoreToken(match[3]!);
    if (!Number.isFinite(server) || score == null || !name) continue;
    sides.push({ server, name, score });
  }
  return sides.length === 2 ? sides : null;
}

function parseSequentialBlocks(lines: string[]): MatchSide[] | null {
  const sides: MatchSide[] = [];
  let pendingServer: number | null = null;
  let pendingName: string | null = null;

  for (const line of lines) {
    const serverOnly = /^#(\d{3,5})$/.exec(line);
    if (serverOnly) {
      pendingServer = Number.parseInt(serverOnly[1]!, 10);
      pendingName = null;
      continue;
    }
    const score = parseScoreToken(line);
    const looksLikeScoreOnly = score != null && /^[\d,.\s]+$/.test(line);
    if (looksLikeScoreOnly && pendingServer != null && pendingName) {
      sides.push({
        server: pendingServer,
        name: pendingName,
        score,
      });
      pendingServer = null;
      pendingName = null;
      continue;
    }
    if (pendingServer != null && !pendingName && !looksLikeScoreOnly) {
      pendingName = line.replace(/^#\d{3,5}\s*/, "").trim();
    }
  }

  return sides.length === 2 ? sides : null;
}

function parseColumnZip(
  lines: string[],
  us: DesertStormAllianceIdentity,
): MatchSide[] | null {
  const servers: number[] = [];
  const scores: number[] = [];
  const leftover: string[] = [];

  for (const line of lines) {
    const lineServers = [...line.matchAll(SERVER_TOKEN_RE)].map((match) =>
      Number.parseInt(match[1]!, 10),
    );
    const lineScores = [...line.matchAll(COMMA_SCORE_RE)]
      .map((match) => parseScoreToken(match[1]!))
      .filter((value): value is number => value != null);

    if (lineServers.length > 0) {
      servers.push(...lineServers);
    }
    if (lineScores.length > 0) {
      scores.push(...lineScores);
    }

    let remainder = line
      .replace(SERVER_TOKEN_RE, " ")
      .replace(COMMA_SCORE_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
    remainder = remainder.replace(/^[-–—|]+|[-–—|]+$/g, "").trim();
    if (remainder) leftover.push(remainder);
  }

  if (servers.length !== 2 || scores.length !== 2) return null;
  if (servers[0] === servers[1]) return null;

  const names = splitConcatenatedNames(leftover.join(" "), us);
  if (!names) return null;

  return [
    { server: servers[0]!, name: names[0], score: scores[0]! },
    { server: servers[1]!, name: names[1], score: scores[1]! },
  ];
}

function splitConcatenatedNames(
  blob: string,
  us: DesertStormAllianceIdentity,
): [string, string] | null {
  const trimmed = blob.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;

  const parts = leftoverNameParts(trimmed);
  if (parts.length === 2 && parts[0] && parts[1]) {
    return [parts[0], parts[1]];
  }

  const oursName = us.name.trim();
  if (oursName.length < 4) return null;
  const idx = indexOfNormalized(trimmed, oursName);
  if (idx < 0) return null;

  const before = trimmed.slice(0, idx).trim();
  const after = trimmed.slice(idx + oursName.length).trim();
  if (before && after) return null;
  if (after) return [oursName, after];
  if (before) return [before, oursName];
  return null;
}

function leftoverNameParts(blob: string): string[] {
  const byBreak = blob
    .split(/\s{2,}|[|/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byBreak.length === 2) return byBreak;
  return [blob];
}

function normalizeAllianceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function indexOfNormalized(haystack: string, needle: string): number {
  const hayNorm = normalizeAllianceName(haystack);
  const needleNorm = normalizeAllianceName(needle);
  if (!hayNorm || !needleNorm || needleNorm.length < 4) return -1;
  const pos = hayNorm.indexOf(needleNorm);
  if (pos < 0) return -1;
  // Map normalized index back approximately by scanning original tokens.
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

function namesMatch(a: string, b: string): boolean {
  const left = normalizeAllianceName(a);
  const right = normalizeAllianceName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 4 && longer.includes(shorter);
}

function pickOursIndex(
  sides: MatchSide[],
  us: DesertStormAllianceIdentity,
): 0 | 1 | null {
  const byServer = sides
    .map((side, index) =>
      side.server === us.gameServerNumber ? index : -1,
    )
    .filter((index) => index >= 0);
  if (byServer.length === 1) {
    return byServer[0] === 0 ? 0 : 1;
  }
  if (byServer.length !== 0) return null;

  const byName = sides
    .map((side, index) => (namesMatch(side.name, us.name) ? index : -1))
    .filter((index) => index >= 0);
  if (byName.length === 1) {
    return byName[0] === 0 ? 0 : 1;
  }
  return null;
}
