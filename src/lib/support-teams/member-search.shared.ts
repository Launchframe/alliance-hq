import { nameMatchScore } from "@/lib/video/member-matcher";
import { memberTeam } from "./policy.shared";
import type { SupportBoard, SupportCommand, SupportRosterMember } from "./types.shared";

export function findSupportMembers(board: SupportBoard, roster: SupportRosterMember[], query: string) {
  const text = query.trim().slice(0, 200);
  return roster.map((member) => ({ memberId: member.id, name: member.name, country: member.country, teamId: memberTeam(board, member.id), score: text ? Math.max(...[member.name, ...member.previousNames].map((name) => nameMatchScore(text, name))) : 1 }))
    .filter((candidate) => candidate.score >= 0.45)
    .sort((a, b) => b.score - a.score || a.memberId.localeCompare(b.memberId));
}
export function selectedMemberCommand(board: SupportBoard, roster: SupportRosterMember[], selectedMemberId: string | null, to: string | null): SupportCommand | null {
  if (!selectedMemberId || !roster.some((member) => member.id === selectedMemberId)) return null;
  return { kind: "move", expectedVersion: board.version, memberId: selectedMemberId, from: memberTeam(board, selectedMemberId), to };
}
