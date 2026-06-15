import type {
  PairingClientInfo,
  PairingMetadata,
  PairingPurpose,
} from "@/lib/credential-pairing/types";
import type { Session } from "@/lib/db/schema";

export type PairingStrategyContext = {
  sourceSession: Session;
  targetSessionId: string;
  metadata: PairingMetadata;
  pairingCodeId: string;
  clientInfo?: PairingClientInfo;
};

export type PairingStrategy = {
  purpose: PairingPurpose;
  validateCreate: (ctx: {
    sourceSession: Session;
    metadata: PairingMetadata;
  }) => Promise<void>;
  onComplete: (ctx: PairingStrategyContext) => Promise<void>;
};
