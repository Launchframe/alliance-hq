import {
  buildMemberIndex,
  matchMemberName,
  type AshedMember,
  type MemberMatch,
  type MemberMatchOptions,
} from "@/lib/video/member-matcher";

export type ParsedPairingLineIssue =
  | "missing_colon"
  | "empty_wl"
  | "empty_engs";

export type ParsedPairingLine = {
  lineNumber: number;
  raw: string;
  wlRaw: string | null;
  engRemainder: string | null;
  issue?: ParsedPairingLineIssue;
};

export type PairingImportWlStatus =
  | "ready"
  | "will_set_profession"
  | "wrong_profession"
  | "unmatched"
  | "no_commander"
  | ParsedPairingLineIssue;

export type PairingImportEngStatus =
  | "ready"
  | "will_set_profession"
  | "already"
  | "other_team"
  | "wrong_profession"
  | "unmatched"
  | "no_commander"
  | "duplicate_in_paste";

export type PairingImportCommander = {
  commanderId: string;
  profession: "Engineer" | "War Leader" | null;
};

export type PairingImportWlPreview = {
  raw: string;
  status: PairingImportWlStatus;
  commanderId: string | null;
  matchedName: string | null;
  matchMethod: MemberMatch["matchMethod"] | null;
};

export type PairingImportEngPreview = {
  raw: string;
  status: PairingImportEngStatus;
  commanderId: string | null;
  matchedName: string | null;
  matchMethod: MemberMatch["matchMethod"] | null;
  otherWlCommanderId: string | null;
};

export type PairingImportLinePreview = {
  lineNumber: number;
  raw: string;
  wl: PairingImportWlPreview;
  engineers: PairingImportEngPreview[];
};

export type PairingImportPreview = {
  lines: PairingImportLinePreview[];
  readyCount: number;
  skippedCount: number;
  /** Profession sets + new assignments that Apply will attempt. */
  commitCount: number;
};

function isExactish(method: MemberMatch["matchMethod"]): boolean {
  return method === "exact" || method === "previous_name";
}

function splitPairingLine(
  raw: string,
): { wlRaw: string; engRemainder: string } | null {
  const colon = raw.indexOf(":");
  if (colon >= 0) {
    return {
      wlRaw: raw.slice(0, colon).trim(),
      engRemainder: raw.slice(colon + 1).trim(),
    };
  }
  const hyphen = raw.search(/[-–—]/);
  if (hyphen < 0) return null;
  return {
    wlRaw: raw.slice(0, hyphen).trim(),
    engRemainder: raw.slice(hyphen + 1).trim(),
  };
}

export function parsePairingImportText(text: string): ParsedPairingLine[] {
  const out: ParsedPairingLine[] = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!.trim();
    if (!raw) continue;
    const split = splitPairingLine(raw);
    if (!split) {
      out.push({
        lineNumber: i + 1,
        raw,
        wlRaw: null,
        engRemainder: null,
        issue: "missing_colon",
      });
      continue;
    }
    const { wlRaw, engRemainder } = split;
    if (!wlRaw) {
      out.push({
        lineNumber: i + 1,
        raw,
        wlRaw: null,
        engRemainder: engRemainder || null,
        issue: "empty_wl",
      });
      continue;
    }
    if (!engRemainder) {
      out.push({
        lineNumber: i + 1,
        raw,
        wlRaw,
        engRemainder: null,
        issue: "empty_engs",
      });
      continue;
    }
    out.push({
      lineNumber: i + 1,
      raw,
      wlRaw,
      engRemainder,
    });
  }
  return out;
}

export function consumeGreedyMemberNames(
  remainder: string,
  index: ReturnType<typeof buildMemberIndex>,
  options?: MemberMatchOptions,
): { raw: string; match: MemberMatch }[] {
  const tokens = remainder.split(/[,\s]+/).filter(Boolean);
  const hits: { raw: string; match: MemberMatch }[] = [];
  let offset = 0;
  while (offset < tokens.length) {
    const slice = tokens.slice(offset);
    const hit = takeLongestName(slice, index, options);
    hits.push(hit);
    const consumed = hit.raw.split(/\s+/).filter(Boolean).length;
    offset += Math.max(1, consumed);
  }
  return hits;
}

function takeLongestName(
  tokens: string[],
  index: ReturnType<typeof buildMemberIndex>,
  options?: MemberMatchOptions,
): { raw: string; match: MemberMatch } {
  let exact: { raw: string; match: MemberMatch } | null = null;
  let fuzzy: { raw: string; match: MemberMatch } | null = null;
  for (let len = tokens.length; len >= 1; len--) {
    const raw = tokens.slice(0, len).join(" ");
    const match = matchMemberName(raw, index, options);
    if (!match.memberId) continue;
    if (isExactish(match.matchMethod)) {
      exact = { raw, match };
      break;
    }
    if (match.matchMethod === "fuzzy" && !fuzzy) {
      fuzzy = { raw, match };
    }
  }
  if (exact) return exact;
  if (fuzzy) return fuzzy;
  const raw = tokens[0] ?? "";
  return { raw, match: matchMemberName(raw, index, options) };
}

function wlStatusFromMatch(input: {
  issue?: ParsedPairingLineIssue;
  match: MemberMatch | null;
  commander: PairingImportCommander | null;
}): PairingImportWlStatus {
  if (input.issue) return input.issue;
  if (!input.match?.memberId) return "unmatched";
  if (!input.commander) return "no_commander";
  if (input.commander.profession === "Engineer") return "wrong_profession";
  if (!input.commander.profession) return "will_set_profession";
  return "ready";
}

function engStatusFromMatch(input: {
  match: MemberMatch;
  commander: PairingImportCommander | null;
  wlCommanderId: string | null;
  activeWlCommanderId: string | null;
  claimedEngCommanderIds: Set<string>;
}): PairingImportEngStatus {
  if (!input.match.memberId) return "unmatched";
  if (!input.commander) return "no_commander";
  if (input.claimedEngCommanderIds.has(input.commander.commanderId)) {
    return "duplicate_in_paste";
  }
  if (input.commander.profession === "War Leader") return "wrong_profession";
  if (
    input.wlCommanderId &&
    input.activeWlCommanderId &&
    input.activeWlCommanderId !== input.wlCommanderId
  ) {
    return "other_team";
  }
  if (
    input.wlCommanderId &&
    input.activeWlCommanderId === input.wlCommanderId
  ) {
    return "already";
  }
  if (!input.commander.profession) return "will_set_profession";
  return "ready";
}

export function isWlApplyable(status: PairingImportWlStatus): boolean {
  return status === "ready" || status === "will_set_profession";
}

export function isEngApplyable(status: PairingImportEngStatus): boolean {
  return status === "ready" || status === "will_set_profession";
}

export function previewPairingImport(input: {
  text: string;
  members: AshedMember[];
  commandersByAshedMemberId: Map<string, PairingImportCommander>;
  activeAssignmentByEngCommanderId: Map<string, string>;
  allianceTag?: string | null;
}): PairingImportPreview {
  const index = buildMemberIndex(input.members);
  const options: MemberMatchOptions | undefined = input.allianceTag
    ? { allianceTag: input.allianceTag }
    : undefined;
  const claimedEngCommanderIds = new Set<string>();
  const parsed = parsePairingImportText(input.text);
  const lines: PairingImportLinePreview[] = [];

  for (const line of parsed) {
    if (line.issue || !line.wlRaw || !line.engRemainder) {
      lines.push({
        lineNumber: line.lineNumber,
        raw: line.raw,
        wl: {
          raw: line.wlRaw ?? line.raw,
          status: line.issue ?? "missing_colon",
          commanderId: null,
          matchedName: null,
          matchMethod: null,
        },
        engineers: [],
      });
      continue;
    }

    const wlMatch = matchMemberName(line.wlRaw, index, options);
    const wlCommander = wlMatch.memberId
      ? (input.commandersByAshedMemberId.get(wlMatch.memberId) ?? null)
      : null;
    const wl: PairingImportWlPreview = {
      raw: line.wlRaw,
      status: wlStatusFromMatch({
        match: wlMatch,
        commander: wlCommander,
      }),
      commanderId: wlCommander?.commanderId ?? null,
      matchedName: wlMatch.memberName,
      matchMethod: wlMatch.matchMethod,
    };

    const engineers: PairingImportEngPreview[] = [];
    for (const hit of consumeGreedyMemberNames(
      line.engRemainder,
      index,
      options,
    )) {
      const commander = hit.match.memberId
        ? (input.commandersByAshedMemberId.get(hit.match.memberId) ?? null)
        : null;
      const status = engStatusFromMatch({
        match: hit.match,
        commander,
        wlCommanderId: wl.commanderId,
        activeWlCommanderId: commander
          ? (input.activeAssignmentByEngCommanderId.get(commander.commanderId) ??
            null)
          : null,
        claimedEngCommanderIds,
      });
      if (commander && status !== "unmatched" && status !== "no_commander") {
        claimedEngCommanderIds.add(commander.commanderId);
      }
      engineers.push({
        raw: hit.raw,
        status,
        commanderId: commander?.commanderId ?? null,
        matchedName: hit.match.memberName,
        matchMethod: hit.match.matchMethod,
        otherWlCommanderId:
          commander && status === "other_team"
            ? (input.activeAssignmentByEngCommanderId.get(
                commander.commanderId,
              ) ?? null)
            : null,
      });
    }

    lines.push({
      lineNumber: line.lineNumber,
      raw: line.raw,
      wl,
      engineers,
    });
  }

  let readyCount = 0;
  let skippedCount = 0;
  let commitCount = 0;
  for (const line of lines) {
    if (!isWlApplyable(line.wl.status)) {
      skippedCount += Math.max(1, line.engineers.length);
      continue;
    }
    if (line.wl.status === "will_set_profession") commitCount += 1;
    for (const eng of line.engineers) {
      if (isEngApplyable(eng.status)) {
        readyCount += 1;
        commitCount += 1;
      } else {
        skippedCount += 1;
      }
    }
  }

  return { lines, readyCount, skippedCount, commitCount };
}
