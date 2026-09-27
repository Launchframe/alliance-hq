import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { AllianceMember, VideoJob } from "@/lib/db/schema";
import {
  frontlinePositiveInteger,
  frontlineRowIssues,
  normalizeFrontlineScore,
  FRONTLINE_BREAKTHROUGH_TARGET,
} from "@/lib/video/frontline-breakthrough.shared";
import { isVideoJobReadyForSubmit } from "@/lib/video/submit-job-ready.shared";
import { computeQualityScore } from "@/lib/video/quality-score";
import { buildReviewOutcomePatch } from "@/lib/video/video-hygiene-instrumentation.shared";

export type FrontlineSubmitRow = {
  id: string;
  memberId?: string | null;
  memberName?: string | null;
  score?: string;
  rank?: number | null;
  frontlineStage?: number | null;
  deleted?: boolean;
};

export type FrontlineSubmitBody = {
  hqEventId?: string;
  recordedDate?: string;
  rows: FrontlineSubmitRow[];
};

export class FrontlineReviewError extends Error {
  constructor(
    readonly code:
      | "frontlineInvalidRows"
      | "frontlineInvalidEvent"
      | "frontlineSaveFailed",
    readonly status = 400,
    readonly issues: Array<{ id: string; fields: string[] }> = [],
  ) {
    super(code);
  }
}

type FrontlineTx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

type FrontlineDb = FrontlineTx | ReturnType<typeof getDb>;

const FRONTLINE_MAX_ROWS = 2000;
const FRONTLINE_MAX_ROW_ID_LENGTH = 128;

function isRealRecordedDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

type SubmittedRow = {
  id: string;
  memberId: string | null;
  memberName: string | null;
  score: string | null;
  rank: number | null;
  frontlineStage: number | null;
  deleted: boolean;
};

function normalizeSubmittedBody(body: FrontlineSubmitBody): {
  rows: SubmittedRow[];
  recordedDate: string;
  hqEventId: string | null;
} {
  if (!body || typeof body !== "object" || !Array.isArray(body.rows)) {
    throw new FrontlineReviewError("frontlineInvalidRows");
  }
  const rows = body.rows;
  if (rows.length === 0 || rows.length > FRONTLINE_MAX_ROWS) {
    throw new FrontlineReviewError("frontlineInvalidRows");
  }
  const normalized: SubmittedRow[] = [];
  const seenIds = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    if (
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      row.id.length > FRONTLINE_MAX_ROW_ID_LENGTH ||
      seenIds.has(row.id)
    ) {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    seenIds.add(row.id);
    const rawDeleted = (row as { deleted?: unknown }).deleted;
    if (rawDeleted === 0 || rawDeleted === 1 || rawDeleted === "0" || rawDeleted === "1") {
      row.deleted = rawDeleted === 1 || rawDeleted === "1";
    }
    if (row.deleted != null && typeof row.deleted !== "boolean") {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    if (row.memberId != null && typeof row.memberId !== "string") {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    if (row.memberName != null && typeof row.memberName !== "string") {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    if (row.score != null && typeof row.score !== "string") {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    normalized.push({
      id: row.id,
      memberId:
        typeof row.memberId === "string" && row.memberId.trim()
          ? row.memberId
          : null,
      memberName: null,
      score: row.score ?? null,
      rank: (row.rank ?? null) as number | null,
      frontlineStage: (row.frontlineStage ?? null) as number | null,
      deleted: row.deleted === true,
    });
  }
  if (
    body.hqEventId != null &&
    (typeof body.hqEventId !== "string" || body.hqEventId.trim() === "")
  ) {
    throw new FrontlineReviewError("frontlineInvalidEvent");
  }
  if (
    typeof body.recordedDate !== "string" ||
    !isRealRecordedDate(body.recordedDate.trim())
  ) {
    throw new FrontlineReviewError("frontlineInvalidEvent");
  }
  return {
    rows: normalized,
    recordedDate: body.recordedDate.trim(),
    hqEventId:
      typeof body.hqEventId === "string" ? body.hqEventId.trim() : null,
  };
}

type ValidatedFrontlineReview = {
  eventId: string;
  recordedDate: string;
  parseSessionId: string;
  rows: Array<{
    id: string;
    memberId: string;
    memberName: string;
    score: string;
    rank: number | null;
    frontlineStage: number;
    deleted: boolean;
  }>;
  allRows: SubmittedRow[];
};

function frontlineMemberId(row: SubmittedRow): string | null {
  return row.memberId && row.memberId.trim() ? row.memberId : null;
}

function validateLoadedFrontlineReview(input: {
  jobId: string;
  parseSession:
    | { jobId: string | null; allianceId: string | null; scoreTarget: string | null }
    | undefined;
  parseSessionId: string;
  event:
    | { allianceId: string | null; scoreTarget: string | null }
    | undefined;
  eventId: string;
  recordedDate: string;
  allianceId: string;
  parsedRows: Array<{
    id: string;
    memberId: string | null;
    memberName: string | null;
    score: string | null;
    rank: number | null;
    frontlineStage: number | null;
  }>;
  roster: AllianceMember[];
  rows: SubmittedRow[];
  previouslySaved: boolean;
}): ValidatedFrontlineReview {
  const parseSession = input.parseSession;
  if (
    !parseSession ||
    parseSession.jobId !== input.jobId ||
    parseSession.allianceId !== input.allianceId ||
    parseSession.scoreTarget !== FRONTLINE_BREAKTHROUGH_TARGET
  ) {
    throw new FrontlineReviewError("frontlineInvalidRows");
  }

  const event = input.event;
  if (
    !event ||
    event.allianceId !== input.allianceId ||
    event.scoreTarget !== FRONTLINE_BREAKTHROUGH_TARGET
  ) {
    throw new FrontlineReviewError("frontlineInvalidEvent");
  }

  const parsedRowById = new Map(input.parsedRows.map((row) => [row.id, row]));
  if (input.rows.some((row) => !parsedRowById.has(row.id))) {
    throw new FrontlineReviewError("frontlineInvalidRows");
  }

  const rosterById = new Map<string, AllianceMember>(
    input.roster.map((member) => [member.ashedMemberId, member]),
  );

  const issues: Array<{ id: string; fields: string[] }> = [];
  const seenMemberIds = new Set<string>();
  const normalizedAll: SubmittedRow[] = [];
  const active: ValidatedFrontlineReview["rows"] = [];

  for (const row of input.rows) {
    if (row.deleted) {
      const original = parsedRowById.get(row.id)!;
      normalizedAll.push({
        id: row.id,
        memberId: original.memberId ?? null,
        memberName: original.memberName ?? null,
        score: original.score ?? null,
        rank: original.rank ?? null,
        frontlineStage: original.frontlineStage ?? null,
        deleted: true,
      });
      continue;
    }

    const memberId = frontlineMemberId(row);
    const member = memberId ? rosterById.get(memberId) : undefined;
    const memberName = member?.currentName?.trim() || null;

    const rowIssues: string[] = [];
    if (!member || !memberName) {
      rowIssues.push("member");
    } else if (seenMemberIds.has(member.ashedMemberId)) {
      rowIssues.push("member");
    }
    rowIssues.push(
      ...frontlineRowIssues({
        frontlineStage: row.frontlineStage,
        score: row.score,
        rank: row.rank,
      }),
    );
    if (rowIssues.length > 0) {
      issues.push({ id: row.id, fields: rowIssues });
      continue;
    }

    seenMemberIds.add(member!.ashedMemberId);
    const normalized = {
      id: row.id,
      memberId: member!.ashedMemberId,
      memberName: memberName!,
      score: normalizeFrontlineScore(row.score)!,
      rank:
        row.rank == null ? null : frontlinePositiveInteger(row.rank),
      frontlineStage: frontlinePositiveInteger(row.frontlineStage)!,
      deleted: false,
    };
    normalizedAll.push(normalized);
    active.push(normalized);
  }

  if (issues.length > 0) {
    throw new FrontlineReviewError("frontlineInvalidRows", 400, issues);
  }
  if (
    active.length === 0 &&
    !(input.previouslySaved && normalizedAll.some((row) => row.deleted))
  ) {
    throw new FrontlineReviewError("frontlineInvalidRows");
  }

  return {
    eventId: input.eventId,
    recordedDate: input.recordedDate,
    parseSessionId: input.parseSessionId,
    rows: active,
    allRows: normalizedAll,
  };
}

async function loadAndValidateFrontlineReview(
  db: FrontlineDb,
  input: {
    jobId: string;
    previouslySaved: boolean;
    parseSessionId: string | null;
    hqEventId: string | null;
    allianceId: string;
    body: FrontlineSubmitBody;
  },
): Promise<ValidatedFrontlineReview> {
  const normalized = normalizeSubmittedBody(input.body);
  if (!input.parseSessionId) {
    throw new FrontlineReviewError("frontlineInvalidRows");
  }
  const eventId = normalized.hqEventId ?? input.hqEventId;
  if (!eventId) {
    throw new FrontlineReviewError("frontlineInvalidEvent");
  }

  const [parseSession] = await db
    .select()
    .from(schema.parseSessions)
    .where(eq(schema.parseSessions.id, input.parseSessionId))
    .limit(1);
  const [event] = await db
    .select()
    .from(schema.hqEvents)
    .where(eq(schema.hqEvents.id, eventId))
    .limit(1);
  const parsedRows = await db
    .select()
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, input.parseSessionId));
  const roster = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.status, "active"),
      ),
    );

  return validateLoadedFrontlineReview({
    jobId: input.jobId,
    parseSession,
    parseSessionId: input.parseSessionId,
    event,
    eventId,
    recordedDate: normalized.recordedDate,
    allianceId: input.allianceId,
    parsedRows,
    roster,
    rows: normalized.rows,
    previouslySaved: input.previouslySaved,
  });
}

export async function validateFrontlineReview(input: {
  job: VideoJob;
  allianceId: string;
  body: FrontlineSubmitBody;
}): Promise<{
  eventId: string;
  recordedDate: string;
  rows: FrontlineSubmitRow[];
}> {
  const validated = await loadAndValidateFrontlineReview(getDb(), {
    jobId: input.job.id,
    previouslySaved: input.job.status === "complete",
    parseSessionId: input.job.parseSessionId,
    hqEventId: input.job.hqEventId ?? null,
    allianceId: input.allianceId,
    body: input.body,
  });
  return {
    eventId: validated.eventId,
    recordedDate: validated.recordedDate,
    rows: validated.allRows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      memberName: row.memberName,
      score: row.score ?? undefined,
      rank: row.rank,
      frontlineStage: row.frontlineStage,
      deleted: row.deleted,
    })),
  };
}

function frontlineMetadataSource(
  metadata: unknown,
): { sourceJobId: string | null; sourceRowId: string | null } {
  if (!metadata || typeof metadata !== "object") {
    return { sourceJobId: null, sourceRowId: null };
  }
  const record = metadata as Record<string, unknown>;
  return {
    sourceJobId:
      typeof record.sourceJobId === "string" ? record.sourceJobId : null,
    sourceRowId:
      typeof record.sourceRowId === "string" ? record.sourceRowId : null,
  };
}

export async function commitFrontlineReview(input: {
  job: VideoJob;
  allianceId: string;
  sessionId: string;
  hqUserId: string;
  body: FrontlineSubmitBody;
}): Promise<{ submitted: number }> {
  return getDb().transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, input.job.id))
      .limit(1)
      .for("update");
    if (!job || job.scoreTarget !== FRONTLINE_BREAKTHROUGH_TARGET) {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    const [canonicalByPk] = job.allianceId
      ? await tx
          .select({ id: schema.alliances.id })
          .from(schema.alliances)
          .where(eq(schema.alliances.id, job.allianceId))
          .limit(1)
      : [undefined];
    const [canonicalByAshed] =
      !canonicalByPk && job.allianceId
        ? await tx
            .select({ id: schema.alliances.id })
            .from(schema.alliances)
            .where(eq(schema.alliances.ashedAllianceId, job.allianceId))
            .limit(1)
        : [undefined];
    const canonicalAllianceId = canonicalByPk?.id ?? canonicalByAshed?.id ?? null;
    if (canonicalAllianceId !== input.allianceId) {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    const firstSave = job.status === "review";
    if (!isVideoJobReadyForSubmit(job.status)) {
      throw new FrontlineReviewError("frontlineSaveFailed", 409);
    }
    if (!job.parseSessionId) {
      throw new FrontlineReviewError("frontlineInvalidRows");
    }
    if (job.parseSessionId !== input.job.parseSessionId) {
      throw new FrontlineReviewError("frontlineSaveFailed", 409);
    }

    const normalized = normalizeSubmittedBody(input.body);
    const eventId = normalized.hqEventId ?? job.hqEventId ?? null;
    if (!eventId) {
      throw new FrontlineReviewError("frontlineInvalidEvent");
    }

    const eventIds = [
      ...new Set(
        [job.hqEventId, eventId].filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ].sort();
    if (eventIds.length > 0) {
      await tx
        .select({ id: schema.hqEvents.id })
        .from(schema.hqEvents)
        .where(inArray(schema.hqEvents.id, eventIds))
        .orderBy(asc(schema.hqEvents.id))
        .for("update");
    }

    const [parseSession] = await tx
      .select()
      .from(schema.parseSessions)
      .where(eq(schema.parseSessions.id, job.parseSessionId))
      .limit(1)
      .for("update");

    const currentParsedRows = await tx
      .select()
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId))
      .orderBy(asc(schema.parsedRows.id))
      .for("update");

    const [event] = await tx
      .select()
      .from(schema.hqEvents)
      .where(eq(schema.hqEvents.id, eventId))
      .limit(1);

    const roster = await tx
      .select()
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          eq(schema.allianceMembers.status, "active"),
        ),
      );

    const validated = validateLoadedFrontlineReview({
      jobId: job.id,
      parseSession,
      parseSessionId: job.parseSessionId,
      event,
      eventId,
      recordedDate: normalized.recordedDate,
      allianceId: input.allianceId,
      parsedRows: currentParsedRows,
      roster,
      rows: normalized.rows,
      previouslySaved: !firstSave,
    });

    const originalRowById = new Map(
      currentParsedRows.map((row) => [row.id, row]),
    );

    const now = new Date();
    const existingMembers = eventIds.length
      ? await tx
          .select()
          .from(schema.hqEventMembers)
          .where(inArray(schema.hqEventMembers.hqEventId, eventIds))
      : [];

    const submittedByRowId = new Map(
      validated.allRows.map((row) => [row.id, row]),
    );
    const staleIds: string[] = [];
    for (const record of existingMembers) {
      const source = frontlineMetadataSource(record.metadata);
      if (source.sourceJobId !== job.id || !source.sourceRowId) continue;
      const submitted = submittedByRowId.get(source.sourceRowId);
      if (!submitted) continue;
      if (
        submitted.deleted ||
        submitted.memberId !== record.memberId ||
        record.hqEventId !== validated.eventId
      ) {
        staleIds.push(record.id);
      }
    }
    if (staleIds.length > 0) {
      await tx
        .delete(schema.hqEventMembers)
        .where(inArray(schema.hqEventMembers.id, staleIds));
    }

    const existingByMember = new Map(
      existingMembers
        .filter(
          (record) =>
            record.hqEventId === validated.eventId &&
            !staleIds.includes(record.id),
        )
        .map((record) => [record.memberId, record]),
    );

    for (const row of validated.rows) {
      const metadata = {
        score: Number(normalizeFrontlineScore(row.score)),
        frontlineStage: row.frontlineStage,
        rank: row.rank ?? null,
        recordedDate: validated.recordedDate,
        sourceJobId: job.id,
        sourceRowId: row.id,
        submittedByHqUserId: input.hqUserId,
        submittedAt: now.toISOString(),
      };
      const existing = existingByMember.get(row.memberId);
      if (existing) {
        await tx
          .update(schema.hqEventMembers)
          .set({ metadata, updatedAt: now })
          .where(eq(schema.hqEventMembers.id, existing.id));
      } else {
        await tx.insert(schema.hqEventMembers).values({
          id: nanoid(16),
          hqEventId: validated.eventId,
          memberId: row.memberId,
          metadata,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const activeIds = new Set(validated.rows.map((row) => row.id));
    let rowsEdited = 0;
    let rowsDeleted = 0;
    let rowsAdded = 0;
    for (const row of validated.allRows) {
      const original = originalRowById.get(row.id);
      const edited =
        !row.deleted &&
        original != null &&
        original.manuallyAdded !== 1 &&
        (original.memberId !== row.memberId ||
          original.memberName !== row.memberName ||
          original.score !== row.score ||
          original.rank !== (row.rank ?? null) ||
          original.frontlineStage !== (row.frontlineStage ?? null));
      if (edited) rowsEdited += 1;
      if (row.deleted && original) rowsDeleted += 1;
      if (!row.deleted && original?.manuallyAdded === 1) rowsAdded += 1;
      await tx
        .update(schema.parsedRows)
        .set({
          memberId: row.memberId ?? null,
          memberName: row.memberName ?? null,
          score: row.score ?? null,
          rank: row.rank ?? null,
          frontlineStage: row.frontlineStage ?? null,
          deleted: row.deleted ? 1 : 0,
          edited: edited ? 1 : 0,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.parsedRows.id, row.id),
            eq(schema.parsedRows.parseSessionId, validated.parseSessionId),
          ),
        );
    }

    const rowsSaved = activeIds.size;
    const quality = computeQualityScore({
      rowsSaved,
      rowsEdited,
      rowsDeleted,
      rowsAdded,
      status: "complete",
    });

    await tx
      .update(schema.videoJobs)
      .set({
        status: "complete",
        hqEventId: validated.eventId,
        recordedDate: validated.recordedDate,
        updatedAt: now,
        ...buildReviewOutcomePatch({
          reviewOpenedAt: job.reviewOpenedAt,
          endedAt: now,
          rowsSaved,
          rowsEdited,
          rowsDeleted,
          rowsAdded,
          qualityScore: quality.qualityScore,
          qualityBucket: quality.qualityBucket,
        }),
      })
      .where(eq(schema.videoJobs.id, job.id));

    await tx
      .update(schema.parseSessions)
      .set({ status: "submitted", updatedAt: now })
      .where(eq(schema.parseSessions.id, validated.parseSessionId));

    await tx.insert(schema.auditLog).values({
      id: nanoid(16),
      sessionId: input.sessionId,
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      action: "frontline.results_saved",
      resourceType: "video_job",
      resourceId: job.id,
      severity: firstSave ? "routine" : "update",
      metadata: {
        rowCount: rowsSaved,
        previousHqEventId: job.hqEventId ?? null,
        hqEventId: validated.eventId,
        recordedDate: validated.recordedDate,
      },
    });

    return { submitted: rowsSaved };
  });
}
