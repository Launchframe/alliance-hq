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
