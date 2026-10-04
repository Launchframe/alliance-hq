import {
  EVENT_FAMILY_POLICY,
  EVENT_LEGACY_LEADERBOARD_CREDIT,
  EVENT_POLL_NO_CREDIT,
  EVENT_POLL_YES_CREDIT,
  type EventEvidenceKind,
  type EventProvenanceKind,
  type EventTarget,
} from "./event-types.shared";
import type { EventEvidenceClass } from "./evidence-merge.shared";

/** Serialized catalog row from GET /api/hq-events. */
export type EventCatalogItem = {
  id: string;
  seriesId: string | null;
  seriesName: string | null;
  name: string;
  target: EventTarget | null;
  scoreTarget: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  policyVersion: number;
  ashedEventId: string | null;
  boardCount: number;
  readyBoards: number;
  resultsCount: number;
  createdAt: string;
};

export type EventBoardDto = {
  id: string;
  allianceId: string;
  hqEventId: string;
  boardKey: string;
  name: string | null;
  scoreType: string | null;
  ashedEventId: string | null;
  evidenceVersion: number;
  readyVersion: number | null;
  readySources: string[] | null;
  readyBy: string | null;
  readyAt: string | null;
  emptyConfirmed: number;
  createdAt: string;
  updatedAt: string;
  /** ready_version === evidence_version, computed server-side. */
  ready: boolean;
};

export type EventResultRow = {
  id: string;
  allianceId: string;
  hqEventId: string;
  boardId: string;
  memberId: string;
  memberName: string | null;
  realScore: string | null;
  stage: number | null;
  observedRank: number | null;
  evidenceClass: EventEvidenceClass;
  participation: string | null;
  conflictKind: string | null;
  contributingObservationIds: string[] | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type EventObservationDto = {
  id: string;
  allianceId: string;
  hqEventId: string;
  boardId: string;
  batchId: string;
  revision: number;
  sourceRowKey: string | null;
  memberId: string;
  memberName: string | null;
  evidenceKind: EventEvidenceKind;
  realScore: string | null;
  stage: number | null;
  observedRank: number | null;
  pollOption: number | null;
  provenance: EventProvenanceKind;
  sourceFrame: string | null;
  sourceOffsetMs: number | null;
  supersedesObservationId: string | null;
  supersededByObservationId: string | null;
  retracted: number;
  correctionActor: string | null;
  correctionReason: string | null;
  createdAt: string;
};

export type EventEvidenceBatchDto = {
  id: string;
  allianceId: string;
  hqEventId: string;
  boardId: string | null;
  sourceKind: string;
  sourceRef: string | null;
  parseRevision: number | null;
  reviewedRevision: number | null;
  status: string;
  requestId: string | null;
  requestSignature: string | null;
  contentHash: string | null;
  importManifest: unknown;
  importStatus: "complete" | "incomplete" | null;
  legacyMappingConfirmed: number | null;
  createdBy: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventEvidencePageDto = {
  boards: EventBoardDto[];
  results: EventResultRow[];
  observations: EventObservationDto[];
  batches: EventEvidenceBatchDto[];
  syncItems: { boardId: string | null; status: string; errorCode: string | null }[];
  nextCursor: string | null;
};

export type EventResultFilter =
  | "scored"
  | "yes_only"
  | "no_only"
  | "conflict"
  | "no_evidence";

/** Projection-only participation credit for display (never a real score). */
export function participationCreditFor(
  row: Pick<EventResultRow, "evidenceClass" | "participation">,
): string | null {
  if (row.evidenceClass === "legacy_leaderboard") {
    return EVENT_LEGACY_LEADERBOARD_CREDIT;
  }
  if (row.participation === "yes" || row.evidenceClass === "yes_only") {
    return EVENT_POLL_YES_CREDIT;
  }
  if (row.participation === "no" || row.evidenceClass === "explicit_no") {
    return EVENT_POLL_NO_CREDIT;
  }
  return null;
}

/** Filter bucket for one merged result row. `none` is computed vs the roster. */
export function resultFilterOf(
  row: Pick<EventResultRow, "evidenceClass" | "participation" | "conflictKind">,
): Exclude<EventResultFilter, "no_evidence"> | null {
  if (row.evidenceClass === "conflict" || row.conflictKind) return "conflict";
  if (row.evidenceClass === "real" || row.evidenceClass === "legacy_leaderboard")
    return "scored";
  if (row.evidenceClass === "yes_only" || row.participation === "yes")
    return "yes_only";
  if (row.evidenceClass === "explicit_no" || row.participation === "no")
    return "no_only";
  return null;
}

/**
 * Exact decimal-string formatting with the active locale. Never Number() —
 * scores may exceed 2^53.
 */
export function formatEventScore(
  score: string | null | undefined,
  locale: string,
): string | null {
  if (score == null || score === "") return null;
  try {
    return new Intl.NumberFormat(locale).format(BigInt(score));
  } catch {
    return score;
  }
}

/** Inclusive-exclusive qualifying minimum for display ("greater than {minimum}"). */
export function scoreMinimumFor(target: EventTarget | null | undefined): string {
  return (
    EVENT_FAMILY_POLICY[target ?? "seasonal"]?.realScoreMinimumExclusive ?? "0"
  );
}

const STORM_TEAM_A_KEYS = new Set(["a", "team_a", "team-a"]);
const STORM_TEAM_B_KEYS = new Set(["b", "team_b", "team-b"]);

/** Storm boardKey → team scope, when recognizable. */
export function boardTeamScope(boardKey: string): "A" | "B" | null {
  const key = boardKey.toLowerCase();
  if (STORM_TEAM_A_KEYS.has(key)) return "A";
  if (STORM_TEAM_B_KEYS.has(key)) return "B";
  return null;
}

const BATCH_SOURCE_KIND_LABEL_KEY: Record<string, string> = {
  manual: "batchSourceManual",
  video: "batchSourceVideo",
  image: "batchSourceImage",
  ashed_import: "batchSourceAshedImport",
  legacy_import: "batchSourceLegacyImport",
};

const BATCH_STATUS_LABEL_KEY: Record<string, string> = {
  staged: "batchStatusStaged",
  committed: "batchStatusCommitted",
  superseded: "batchStatusSuperseded",
};

/** i18n key under `eventEvidence` for a batch source kind (fallback: unknown). */
export function batchSourceKindLabelKey(sourceKind: string): string {
  return BATCH_SOURCE_KIND_LABEL_KEY[sourceKind] ?? "batchSourceUnknown";
}

/** i18n key under `eventEvidence` for a batch lifecycle status (fallback: unknown). */
export function batchStatusLabelKey(status: string): string {
  return BATCH_STATUS_LABEL_KEY[status] ?? "batchStatusUnknown";
}

export type EventSyncItemStatus =
  | "pending"
  | "synced"
  | "conflict"
  | "failed"
  | "unsupported"
  | "uncertain";

export type EventSyncAggregate = {
  /** Aggregated Ashed status for a board; "none" when no sync items exist. */
  status: EventSyncItemStatus | "none";
  /** First error code behind a failing aggregate (e.g. precisionUnsupported). */
  errorCode: string | null;
  total: number;
};

const SYNC_STATUS_SEVERITY: Record<EventSyncItemStatus, number> = {
  conflict: 5,
  uncertain: 4,
  unsupported: 3,
  failed: 2,
  pending: 1,
  synced: 0,
};

/** Roll sync items up to one worst-case status + its error code. */
export function aggregateEventSync(
  items: readonly { status: string; errorCode: string | null }[],
): EventSyncAggregate {
  let worst: EventSyncItemStatus | null = null;
  let errorCode: string | null = null;
  for (const item of items) {
    const status = item.status as EventSyncItemStatus;
    const severity = SYNC_STATUS_SEVERITY[status];
    if (severity == null) continue;
    if (worst == null || severity > SYNC_STATUS_SEVERITY[worst]) {
      worst = status;
      errorCode = item.errorCode;
    }
  }
  return { status: worst ?? "none", errorCode, total: items.length };
}
