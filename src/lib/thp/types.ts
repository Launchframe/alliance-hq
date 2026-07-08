import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

export type ThpPendingState =
  | {
      kind: "anomaly_confirm";
      proposedTotal: number;
      proposedBreakdown: ThpBreakdown | null;
      commanderId: string;
    }
  | {
      kind: "ocr_confirm";
      proposedTotal: number;
      proposedBreakdown: ThpBreakdown | null;
      commanderId: string;
    }
  | { kind: "pick_character"; linkIds: string[] };

export type ThpCommandAction =
  | {
      type: "set_thp";
      total: number;
      breakdown: ThpBreakdown | null;
      commanderId: string;
      flagReason?: string | null;
    }
  | { type: "none" };

export type ThpCommandResult = {
  reply: string;
  pending: ThpPendingState | null;
  action: ThpCommandAction;
  needsConfirmation?: boolean;
  proposedTotal?: number;
  proposedBreakdown?: ThpBreakdown | null;
  characterPicker?: Array<{ linkId: string; label: string }>;
};
