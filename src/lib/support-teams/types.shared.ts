export type SupportRosterMember = {
  id: string;
  name: string;
  previousNames: string[];
  rank: number | null;
  country: string | null;
  professionLevel: number | null;
  baseLevel: number | null;
  basePower: number | null;
  kills: number | null;
  thp: number | null;
  tenureDays: number | null;
  draftStintToken?: string;
  hqLinked: boolean;
  discordLinked: boolean;
};

export type SupportActor = {
  allianceId: string;
  principalId: string;
  displayName?: string | null;
  canRead: boolean;
  canWrite: boolean;
  override: boolean;
  linkedMemberIds: string[];
};

export type SupportValue = string | number | boolean | null;
export type SupportField = { value: SupportValue; version: number; actionId: string | null };
export type SupportContext = {
  mode: "setup" | "maintenance" | "draft" | "proposal" | "undo";
  draftId?: string;
  proposalId?: string;
  proposalVersion?: number;
  round?: number;
  representedLeadId?: string;
  sourceActionId?: string;
};
export type SupportBoard = {
  allianceId: string;
  version: number;
  published: boolean;
  construction: { kind: "draft" | "proposal"; id: string } | null;
  fields: Record<string, SupportField>;
};
export type SupportSnapshot = {
  version: number;
  published: boolean;
  teams: { id: string; name: string | null; leadId: string | null; target: number; memberIds: string[]; needsReplacement: boolean }[];
  roster: SupportRosterMember[];
  linkedMemberIds: string[];
  canWrite: boolean;
  board?: SupportBoard;
  actor?: SupportActor;
};
export type SupportPatch = { key: string; before: SupportValue; after: SupportValue; beforeVersion: number; afterVersion: number };
export type SupportEvent = {
  id: string;
  allianceId: string;
  principalId: string;
  actorName: string | null;
  memberNames: Record<string, string>;
  teamNames: Record<string, string | null>;
  at: string;
  kind: SupportCommand["kind"] | "undo" | "reconcile" | "scheduleDraft" | "draftPick" | "advanceDraft" | "extendDraft" | "publishDraft" | "cancelDraft";
  principalType?: "human" | "service";
  actorType?: "user" | "service";
  context: SupportContext;
  boardVersion: number;
  idempotencyKey: string;
  patches: SupportPatch[];
  observedVersions: Record<string, number>;
  dependsOn: string[];
  reverses: string[];
  teamIds: string[];
  memberIds: string[];
};
export type EventIdentity = Pick<SupportEvent, "id" | "at" | "idempotencyKey">;
export type SupportCommand = { expectedVersion: number } & (
  | { kind: "createTeam"; teamId: string; leadId: string }
  | { kind: "replaceLead"; teamId: string; leadId: string }
  | { kind: "rename"; teamId: string; name: string }
  | { kind: "move"; memberId: string; from: string | null; to: string | null }
  | { kind: "swap"; memberId: string; otherMemberId: string; from: string; to: string }
);
export type SupportErrorCode = "forbidden" | "changed" | "memberUnavailable" | "leadRequired" | "teamFull" | "nameRequired" | "nameLimit" | "dependencies" | "invalid" | "undone" | "notOpen" | "proxyEarly";
export class SupportError extends Error {
  constructor(public readonly code: SupportErrorCode, public readonly details?: { deadline?: string }) { super(code); }
}
export type UndoPreview = {
  rootActionId: string;
  actionIds: string[];
  expectedVersions: Record<string, number>;
  patches: SupportPatch[];
};
