export type VrPendingState =
  | { kind: "anomaly_confirm"; proposedVr: number; ashedMemberId: string }
  | { kind: "pick_character"; linkIds: string[] };

export type VrCommandAction =
  | {
      type: "set_vr";
      vr: number;
      ashedMemberId: string;
      flagReason?: string | null;
    }
  | { type: "none" };

export type VrCommandResult = {
  reply: string;
  pending: VrPendingState | null;
  action: VrCommandAction;
  needsConfirmation?: boolean;
  proposedVr?: number;
  characterPicker?: Array<{ linkId: string; label: string }>;
};

export type LinkPendingState =
  | { kind: "link_walkthrough"; step: number }
  | {
      kind: "link_fuzzy_pick";
      candidates: Array<{ memberId: string; name: string }>;
      gameUid: string;
      gameUserName: string;
      reportedName: string;
    };

export type LinkCommandResult = {
  reply: string;
  pending: LinkPendingState | null;
  components?: unknown[];
  linked?: boolean;
  needsOfficerAttention?: boolean;
  linkTarget?: {
    ashedMemberId: string;
    memberDisplayName: string;
    gameUid: string;
  };
};
