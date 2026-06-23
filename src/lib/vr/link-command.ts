import type { AshedMember } from "@/lib/video/member-matcher";

import type { DiscordTranslate } from "@/lib/discord/i18n";
import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import {
  advanceLinkWalkthrough,
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
  allianceTag?: string | null;
};

export function processLinkCommand(input: ProcessLinkInput): LinkCommandResult {
  const { translate: t } = input;

  if (input.pending?.kind === "link_walkthrough") {
    const currentStep = input.walkthroughStep ?? input.pending.step;
    const advanced = advanceLinkWalkthrough({
      step: currentStep,
      translate: t,
      steps: input.walkthroughSteps,
    });
    return { reply: advanced.reply, pending: advanced.pending };
  }

  if (!input.lookup.ok) {
    return { reply: input.lookup.message, pending: null };
  }

  const { gameUserName, gameUserLevel } = input.lookup;

  if (input.members.length === 0) {
    return {
      reply: t("link.rosterUnavailable"),
      pending: null,
      needsOfficerAttention: true,
    };
  }

  if (!namesMatch(input.reportedName, gameUserName)) {
    return {
      reply: `${walkthroughMessage(0, t, input.walkthroughSteps)}\n\n${t("link.nameMismatchIntro")}`,
      pending: { kind: "link_walkthrough", step: 0 },
    };
  }

  const exact = findExactMemberByName(input.members, gameUserName);
  if (exact) {
    if (input.linkedMemberIds.has(exact.id)) {
      return {
        reply: t("link.memberTaken"),
        pending: null,
        memberTaken: true,
      };
    }
    return {
      reply: t("link.linked", { name: exact.current_name }),
      pending: null,
      linked: true,
      linkTarget: {
        ashedMemberId: exact.id,
        memberDisplayName: exact.current_name,
        gameUid: input.gameUid.trim(),
        ...(gameUserLevel != null ? { gameUserLevel } : {}),
      },
    };
  }

  const candidates = fuzzyUnlinkedCandidates(
    input.members,
    input.linkedMemberIds,
    input.reportedName,
  );
  const gameNameCandidates =
    candidates.length === 0
      ? fuzzyUnlinkedCandidates(
          input.members,
          input.linkedMemberIds,
          gameUserName,
        )
      : [];
  const mergedCandidates = candidates.length > 0 ? candidates : gameNameCandidates;
  if (mergedCandidates.length > 0) {
    return {
      reply: t("link.fuzzyPrompt", { gameName: gameUserName }),
      pending: {
        kind: "link_fuzzy_pick",
        candidates: mergedCandidates.map((c) => ({
          memberId: c.memberId,
          name: c.name,
        })),
        gameUid: input.gameUid.trim(),
        gameUserName,
        reportedName: input.reportedName,
        ...(gameUserLevel != null ? { gameUserLevel } : {}),
      },
    };
  }

  return {
    reply: input.allianceTag
      ? t("link.rosterMiss", { tag: input.allianceTag })
      : t("link.rosterMissGeneric"),
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
      ...(input.pending.gameUserLevel != null
        ? { gameUserLevel: input.pending.gameUserLevel }
        : {}),
    },
  };
}
