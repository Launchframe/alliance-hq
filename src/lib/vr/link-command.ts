import type { AshedMember } from "@/lib/video/member-matcher";

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
};

export function processLinkCommand(input: ProcessLinkInput): LinkCommandResult {
  if (input.pending?.kind === "link_walkthrough") {
    const nextStep = (input.walkthroughStep ?? input.pending.step) + 1;
    if (nextStep >= 5) {
      return {
        reply:
          "Great. Run `/link` again with your copied name and UID when ready.",
        pending: null,
      };
    }
    return {
      reply: walkthroughMessage(nextStep),
      pending: { kind: "link_walkthrough", step: nextStep },
    };
  }

  if (!input.lookup.ok) {
    return { reply: input.lookup.message, pending: null };
  }

  const { gameUserName } = input.lookup;
  if (!namesMatch(input.reportedName, gameUserName)) {
    return {
      reply: `${walkthroughMessage(0)}\n\nTap **Done** when you've finished this step.`,
      pending: { kind: "link_walkthrough", step: 0 },
    };
  }

  const exact = findExactMemberByName(input.members, gameUserName);
  if (exact) {
    return {
      reply: `Linked to **${exact.current_name}**. You're ready to use /vr.`,
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
      reply: `We verified **${gameUserName}** but couldn't find an exact roster match. Pick your member:`,
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
    reply:
      "We couldn't match that name to anyone on the roster. Try **Start over** for copy instructions, or ask an officer for help.",
    pending: null,
    needsOfficerAttention: true,
  };
}

export function processLinkFuzzyPick(input: {
  pending: LinkPendingState;
  memberId: string;
}): LinkCommandResult {
  if (input.pending.kind !== "link_fuzzy_pick") {
    return { reply: "Nothing to pick right now.", pending: null };
  }
  const candidate = input.pending.candidates.find(
    (c) => c.memberId === input.memberId,
  );
  if (!candidate) {
    return { reply: "That member option expired. Run `/link` again.", pending: null };
  }
  return {
    reply: `Linked to **${candidate.name}**. You're ready to use /vr.`,
    pending: null,
    linked: true,
    linkTarget: {
      ashedMemberId: candidate.memberId,
      memberDisplayName: candidate.name,
      gameUid: input.pending.gameUid,
    },
  };
}
