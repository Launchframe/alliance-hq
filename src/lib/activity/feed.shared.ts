import type { ActivityEventKey } from "./catalog.shared";
import type {
  ActivityChannel,
  ActivityKind,
  ActivityMethod,
  ActivityRank,
  ActivityResourceKey,
  ActivityRole,
  ActivitySeverity,
  ActivityTool,
} from "./types.shared";

export const ACTIVITY_SCOPES = ["personal", "alliance", "global"] as const;
export type ActivityFeedScope = (typeof ACTIVITY_SCOPES)[number];

export type ActivityFeedFilters = {
  from?: string;
  to?: string;
  channel?: ActivityChannel;
  category?: string;
  kind?: ActivityKind;
  actor?: string;
  allianceId?: string;
  server?: string;
};

export type ActivityFeedValues = {
  value?: string;
  member?: string | null;
  fromRank?: ActivityRank;
  toRank?: ActivityRank;
  rank?: ActivityRank;
  fromRole?: ActivityRole;
  toRole?: ActivityRole;
  tool?: ActivityTool;
};

export type ActivityFeedItem = {
  id: string;
  occurredAt: string;
  eventKey: ActivityEventKey;
  feature: string;
  kind: ActivityKind;
  descriptor: string;
  resource: ActivityResourceKey | null;
  values: ActivityFeedValues;
  details: {
    previousValue?: string | null;
    affected?: number;
    completed?: number;
  };
  actor: {
    key: string | null;
    displayName: string | null;
    hqRole: ActivityRole | null;
    gameRank: ActivityRank | null;
    unlinkedHq: boolean;
  } | null;
  alliance: {
    id: string;
    serverNumber: string | null;
    tag: string | null;
    name: string | null;
  } | null;
  channel: ActivityChannel | null;
  method: ActivityMethod | null;
  severity: ActivitySeverity;
  historical: boolean;
  historicalCurrentLabels: boolean;
};

export type ActivityFeedPage = {
  items: ActivityFeedItem[];
  nextCursor: string | null;
  head: { id: string; occurredAt: string } | null;
  scope: ActivityFeedScope;
  scopeFence: string;
  allowedScopes: ActivityFeedScope[];
};

export type ActivityFeedHeadResponse = {
  head: { id: string; occurredAt: string } | null;
  scope: ActivityFeedScope;
  scopeFence: string;
  allowedScopes: ActivityFeedScope[];
};

export type ActivityFeedOptions = {
  actors: { value: string; label: string | null }[];
  alliances: {
    id: string;
    tag: string | null;
    name: string | null;
    serverNumber: string | null;
  }[];
  servers: string[];
  categories: string[];
  channels: ActivityChannel[];
  kinds: ActivityKind[];
};

export type ActivityFeedOptionsResponse = {
  options: ActivityFeedOptions;
  scope: ActivityFeedScope;
  scopeFence: string;
  allowedScopes: ActivityFeedScope[];
};
