import type { AshedMember } from "@/lib/video/member-matcher";
import { findFuzzyMemberCandidates } from "@/lib/video/member-matcher";

import type { DiscordTranslate } from "@/lib/discord/i18n";

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

export function walkthroughMessage(
  step: number,
  translate: DiscordTranslate,
  steps: readonly string[],
): string {
  const index = Math.max(0, Math.min(step, steps.length - 1));
  const lines = steps.map((text, i) =>
    i === index ? `→ ${text}` : `${i + 1}. ${text}`,
  );
  return `${translate("link.walkthroughIntro")}\n\n${lines.join("\n")}\n\n${translate("link.walkthroughTapDone")}`;
}
