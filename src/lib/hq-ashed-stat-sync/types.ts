import type { ParsedConnection } from "@/lib/connectionString";

export type MonotonicStatId = "thp" | "kills" | "level";

export type StatSyncReviewRow = {
  stat: MonotonicStatId;
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
  hqTotal: number;
  ashedTotal: number | null;
  hqSource: string | null;
  hqUpdatedAt: string | null;
  eventId: string | null;
  reason: "pending_outbound" | "inbound_conflict";
};

export type StatSyncAdapter = {
  stat: MonotonicStatId;
  ashedField: "current_total_hero_power" | "current_kills" | "level";
  getHqCurrent: (commanderId: string) => Promise<{
    total: number | null;
    updatedAt: Date | null;
    latestSource: string | null;
    pendingUnsyncedSelfReport: boolean;
    latestEventId: string | null;
  }>;
  applyAshedOnHq: (input: {
    commanderId: string;
    allianceId: string;
    ashedMemberId: string;
    memberName: string;
    total: number;
    source: "ashed_sync" | "officer_override";
    hqUserId?: string | null;
  }) => Promise<boolean>;
  putToAshed: (
    connection: ParsedConnection,
    ashedMemberId: string,
    total: number,
  ) => Promise<void>;
  markEventSynced: (eventId: string) => Promise<void>;
  markEventDiscarded: (eventId: string) => Promise<void>;
  revertHqToPrevious: (input: {
    commanderId: string;
    allianceId: string;
    ashedMemberId: string;
    memberName: string;
    hqUserId?: string | null;
    /** When set, discard this event and restore from its previousTotal only. */
    eventIdToDiscard?: string | null;
  }) => Promise<number | null>;
  listPendingOutbound: (allianceId: string) => Promise<StatSyncReviewRow[]>;
};

export { decideInboundStatApply } from "@/lib/hq-ashed-stat-sync/policy";
export type {
  InboundStatDecision,
  InboundStatCompareInput,
} from "@/lib/hq-ashed-stat-sync/policy";
