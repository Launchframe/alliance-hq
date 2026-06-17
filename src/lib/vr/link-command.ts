import type { AshedMember } from "@/lib/video/member-matcher";

import type { DiscordTranslate } from "@/lib/discord/i18n";
import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import {
  findExactMemberByName,
  fuzzyUnlinkedCandidates,
  namesMatch,
  walkthroughMessage,
} from "@/lib/vr/link-helpers";
import type { LinkCommandResult, LinkPendingState } from "@/lib/vr/types";

export type ProcessLinkInput = {
  reportedName: string;
  gameUid: string;
  lookup: LastWarPlayerLookupResult;
  members: AshedMember[];
  linkedMemberIds: Set<string>;
  pending: LinkPendingState | null;
  walkthroughStep?: number;
  translate: DiscordTranslate;
  walkthroughSteps: readonly string[];
};

export function processLinkCommand(input: ProcessLinkInput): LinkCommandResult {
  const { translate: t } = input;

  if (input.pending?.kind === "link_walkthrough") {
    const nextStep = (input.walkthroughStep ?? input.pending.step) + 1;
    if (nextStep >= input.walkthroughSteps.length) {
      return {
        reply: t("link.walkthroughDone"),
        pending: null,
      };
    }
    return {
      reply: walkthroughMessage(nextStep, t, input.walkthroughSteps),
      pending: { kind: "link_walkthrough", step: nextStep },
    };
  }

  if (!input.lookup.ok) {
    return { reply: input.lookup.message, pending: null };
  }

  const { gameUserName } = input.lookup;
  if (!namesMatch(input.reportedName, gameUserName)) {
    return {
      reply: `${walkthroughMessage(0, t, input.walkthroughSteps)}\n\n${t("link.nameMismatchIntro")}`,
      pending: { kind: "link_walkthrough", step: 0 },
    };
  }

  const exact = findExactMemberByName(input.members, gameUserName);
  if (exact) {
    return {
      reply: t("link.linked", { name: exact.current_name }),
      pending: null,
      linked: true,
      linkTarget: {
        ashedMemberId: exact.id,
        memberDisplayName: exact.current_name,
        gameUid: input.gameUid.trim(),
      },
    };
  }

  const candidates = fuzzyUnlinkedCandidates(
    input.members,
    input.linkedMemberIds,
    input.reportedName,
  );
  if (candidates.length > 0) {
    return {
      reply: t("link.fuzzyPrompt", { gameName: gameUserName }),
      pending: {
        kind: "link_fuzzy_pick",
        candidates: candidates.map((c) => ({
          memberId: c.memberId,
          name: c.name,
        })),
        gameUid: input.gameUid.trim(),
        gameUserName,
        reportedName: input.reportedName,
      },
    };
  }

  return {
    reply: t("link.rosterMiss"),
    pending: null,
    needsOfficerAttention: true,
  };
}

export function processLinkFuzzyPick(input: {
  pending: LinkPendingState;
  memberId: string;
  translate: DiscordTranslate;
}): LinkCommandResult {
  const { translate: t } = input;
  if (input.pending.kind !== "link_fuzzy_pick") {
    return { reply: t("errors.nothingPending"), pending: null };
  }
  const candidate = input.pending.candidates.find(
    (c) => c.memberId === input.memberId,
  );
  if (!candidate) {
    return { reply: t("link.pickExpired"), pending: null };
  }
  return {
    reply: t("link.linked", { name: candidate.name }),
    pending: null,
    linked: true,
    linkTarget: {
      ashedMemberId: candidate.memberId,
      memberDisplayName: candidate.name,
      gameUid: input.pending.gameUid,
    },
  };
}
