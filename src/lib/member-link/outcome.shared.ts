import type { LinkCommandResult, LinkPendingState } from "@/lib/vr/types";

export type MemberLinkOutcome =
  | "linked"
  | "walkthrough"
  | "walkthrough_done"
  | "fuzzy_pick"
  | "roster_miss"
  | "lookup_error"
  | "usage"
  | "member_taken"
  | "pick_expired"
  | "officer_notified"
  | "ashed_verification_required"
  | "roster_unavailable";

export type MemberLinkApiResponse = {
  outcome: MemberLinkOutcome;
  message: string;
  pending: LinkPendingState | null;
  candidates?: Array<{ memberId: string; name: string }>;
  walkthroughStep?: number;
  linkedMemberName?: string;
};

export function toMemberLinkApiResponse(
  result: LinkCommandResult,
  options?: {
    usage?: boolean;
    lookupError?: boolean;
    memberTaken?: boolean;
    pickExpired?: boolean;
    officerNotified?: boolean;
    walkthroughDone?: boolean;
  },
): MemberLinkApiResponse {
  if (options?.officerNotified) {
    return {
      outcome: "officer_notified",
      message: result.reply,
      pending: null,
    };
  }
  if (options?.memberTaken) {
    return {
      outcome: "member_taken",
      message: result.reply,
      pending: null,
    };
  }
  if (options?.pickExpired) {
    return {
      outcome: "pick_expired",
      message: result.reply,
      pending: null,
    };
  }
  if (options?.usage) {
    return {
      outcome: "usage",
      message: result.reply,
      pending: null,
    };
  }
  if (options?.lookupError) {
    return {
      outcome: "lookup_error",
      message: result.reply,
      pending: null,
    };
  }
  if (options?.walkthroughDone) {
    return {
      outcome: "walkthrough_done",
      message: result.reply,
      pending: null,
    };
  }
  if (result.linked) {
    return {
      outcome: "linked",
      message: result.reply,
      pending: null,
      linkedMemberName: result.linkTarget?.memberDisplayName,
    };
  }
  if (result.pending?.kind === "link_fuzzy_pick") {
    return {
      outcome: "fuzzy_pick",
      message: result.reply,
      pending: result.pending,
      candidates: result.pending.candidates,
    };
  }
  if (result.pending?.kind === "link_walkthrough") {
    return {
      outcome: "walkthrough",
      message: result.reply,
      pending: result.pending,
      walkthroughStep: result.pending.step,
    };
  }
  if (result.needsOfficerAttention) {
    return {
      outcome: "roster_miss",
      message: result.reply,
      pending: null,
    };
  }
  return {
    outcome: "lookup_error",
    message: result.reply,
    pending: null,
  };
}
