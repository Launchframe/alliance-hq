import type { AshedMember } from "@/lib/video/member-matcher";

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
  for (const member of members) {
    if (member.status === "former") continue;
    if (normalizeName(member.current_name) === needle) {
      return member;
    }
    for (const previous of member.previous_names ?? []) {
      if (normalizeName(previous) === needle) {
        return member;
      }
    }
  }
  return null;
}

/**
 * The verified Last War name must be at least this long before we trust a
 * substring suggestion. Short names produce too many spurious overlaps.
 */
export const ROSTER_SUBSTRING_MIN_NEEDLE_CHARS = 4;
/**
 * A roster name must be at least this long to be the matched (shorter) side.
 * Keeps the headline "Mew" → "Mew2407" case working while rejecting 1–2 char
 * roster noise.
 */
export const ROSTER_SUBSTRING_MIN_ROSTER_CHARS = 3;

export type RosterSubstringSuggestion = {
  ashedMemberId: string;
  memberName: string;
  matchedRosterName: string;
  method: "substring";
};

/**
 * Suggest a single roster member when the verified game name and exactly one
 * roster name contain one another (e.g. "Mew" ⊂ "Mew2407"). Returns null on
 * zero or ambiguous matches. This is a UI hint for officer approval only — it
 * must never be used to auto-link a commander.
 */
export function findUniqueSubstringRosterCandidate(
  members: AshedMember[],
  gameUserName: string,
): RosterSubstringSuggestion | null {
  const needle = normalizeName(gameUserName);
  if (needle.length < ROSTER_SUBSTRING_MIN_NEEDLE_CHARS) {
    return null;
  }

  const matches = new Map<string, RosterSubstringSuggestion>();

  for (const member of members) {
    if (member.status === "former") continue;
    const candidates = [member.current_name, ...(member.previous_names ?? [])];
    for (const candidate of candidates) {
      const rosterName = normalizeName(candidate);
      if (rosterName.length < ROSTER_SUBSTRING_MIN_ROSTER_CHARS) continue;
      // Exact matches are handled by findExactMemberByName; skip them here.
      if (rosterName === needle) continue;

      const isSubstring =
        needle.includes(rosterName) || rosterName.includes(needle);
      if (!isSubstring) continue;

      if (!matches.has(member.id)) {
        matches.set(member.id, {
          ashedMemberId: member.id,
          memberName: member.current_name,
          matchedRosterName: candidate,
          method: "substring",
        });
      }
    }
  }

  if (matches.size !== 1) {
    return null;
  }
  return [...matches.values()][0] ?? null;
}

export function advanceLinkWalkthrough(input: {
  step: number;
  translate: DiscordTranslate;
  steps: readonly string[];
}): {
  reply: string;
  pending: { kind: "link_walkthrough"; step: number } | null;
} {
  const nextStep = input.step + 1;
  if (nextStep >= input.steps.length) {
    return {
      reply: input.translate("link.walkthroughDone"),
      pending: null,
    };
  }
  return {
    reply: walkthroughMessage(nextStep, input.translate, input.steps),
    pending: { kind: "link_walkthrough", step: nextStep },
  };
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
