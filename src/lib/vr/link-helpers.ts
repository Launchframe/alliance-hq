import type { AshedMember } from "@/lib/video/member-matcher";
import { findFuzzyMemberCandidates } from "@/lib/video/member-matcher";

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function namesMatch(reported: string, gameUserName: string): boolean {
  return normalizeName(reported) === normalizeName(gameUserName);
}

export function findExactMemberByName(
  members: AshedMember[],
  gameUserName: string,
): AshedMember | null {
  const needle = normalizeName(gameUserName);
  return (
    members.find((m) => normalizeName(m.current_name) === needle) ?? null
  );
}

export function fuzzyUnlinkedCandidates(
  members: AshedMember[],
  linkedMemberIds: Set<string>,
  reportedName: string,
  limit = 5,
): Array<{ memberId: string; name: string; confidence: number }> {
  const unlinked = members.filter(
    (m) => m.status !== "former" && !linkedMemberIds.has(m.id),
  );
  return findFuzzyMemberCandidates(reportedName, unlinked, { limit });
}

export const LINK_WALKTHROUGH_STEPS = [
  "Open the game.",
  "Tap your avatar picture to open your Player's Profile menu.",
  'Tap the "..." menu in the top right to open the Profile menu.',
  'Tap "Copy" next to your name on that screen.',
  "Run `/link` again and paste that copied name with your UID.",
] as const;

export function walkthroughMessage(step: number): string {
  const index = Math.max(0, Math.min(step, LINK_WALKTHROUGH_STEPS.length - 1));
  const lines = LINK_WALKTHROUGH_STEPS.map((text, i) =>
    i === index ? `→ ${text}` : `${i + 1}. ${text}`,
  );
  return `Let's start over.\n\n${lines.join("\n")}\n\nTap **Done** when you've finished this step.`;
}
