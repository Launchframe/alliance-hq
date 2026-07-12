export type KillsPendingState =
  | {
      kind: "anomaly_confirm";
      proposedTotal: number;
      commanderId: string;
    }
  | {
      kind: "pick_character";
      linkIds: string[];
      proposedTotal?: number | null;
    };

export type KillsCommandAction =
  | {
      type: "set_kills";
      total: number;
      commanderId: string;
      flagReason?: string | null;
    }
  | { type: "none" };

export type KillsCommandResult = {
  reply: string;
  pending: KillsPendingState | null;
  action: KillsCommandAction;
  needsConfirmation?: boolean;
  proposedTotal?: number;
  characterPicker?: Array<{ linkId: string; label: string }>;
};
