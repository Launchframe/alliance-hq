import {
  findFuzzyMemberCandidates,
  matchMemberName,
  buildMemberIndex,
  type AshedMember,
} from "@/lib/video/member-matcher";
import { PERFORMANCE_NOTE_AUTO_MATCH_MIN } from "@/lib/performance-notes/names.shared";

export type PerformanceNoteCandidate = {
  memberId: string;
  name: string;
};

export type NameMatchDecision =
  | { action: "auto"; memberId: string; memberName: string }
  | {
      action: "clarify";
      token: string;
      candidates: PerformanceNoteCandidate[];
    }
  | { action: "none"; token: string };

export function decideNameMatch(
  token: string,
  members: AshedMember[],
  allianceTag?: string | null,
): NameMatchDecision {
  const trimmed = token.trim();
  if (!trimmed) {
    return { action: "none", token };
  }
  const index = buildMemberIndex(members);
  const match = matchMemberName(trimmed, index, { allianceTag });
  const uniqueHighConfidence =
    match.memberId &&
    match.memberName &&
    (match.matchMethod === "exact" ||
      match.matchMethod === "previous_name" ||
      match.confidence >= PERFORMANCE_NOTE_AUTO_MATCH_MIN);
  if (uniqueHighConfidence && match.memberId && match.memberName) {
    return {
      action: "auto",
      memberId: match.memberId,
      memberName: match.memberName,
    };
  }
  const candidates = findFuzzyMemberCandidates(trimmed, members, {
    allianceTag,
    limit: 5,
  }).map((row) => ({ memberId: row.memberId, name: row.name }));
  if (candidates.length === 0) {
    return { action: "none", token: trimmed };
  }
  return { action: "clarify", token: trimmed, candidates };
}
