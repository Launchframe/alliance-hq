import "server-only";

import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import type { VideoJob } from "@/lib/db/schema";
import { MAX_SCREENSHOT_UPLOAD_BYTES } from "@/lib/ocr/screenshot-upload.shared";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { loadSession } from "@/lib/session";
import {
  copyObjectBounded,
  getObjectStream,
  putLocalObjectStreamBounded,
  r2Configured,
} from "@/lib/storage";
import { presignR2PutObject } from "@/lib/storage/r2";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { vsAshedSyncEligibility } from "@/lib/vs-performance/ashed-opponent-sync.server";
import { loadVsMatchup } from "@/lib/vs-performance/match-results.repository.server";
import {
  vsContextScope,
  vsScope,
} from "@/lib/vs-performance/vs-scope.server";
import type {
  VsCaptureCandidate,
  VsCaptureKind,
} from "@/lib/vs-performance/vs-capture.shared";
import {
  vsVideoContextSchema,
  vsVideoDraftSchema,
  vsVideoRequestedKindSchema,
  vsVideoWeekStart,
  type VsVideoContext,
  type VsVideoEvidenceResponse,
} from "@/lib/vs-performance/video-evidence.shared";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import type { VsActor } from "@/lib/vs-performance/weekly-view.shared";
import { resolveVideoJobAccess } from "@/lib/video/video-job-access.server";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";
import { defaultVsPerformanceRecordedDate } from "@/lib/video/vs-recorded-date.shared";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";

const EVIDENCE_STATUS = {
  none: "none",
  uploading: "uploading",
  queued: "queued",
  running: "running",
  needsType: "needs_type",
  ready: "ready",
  failed: "failed",
} as const;

export type VsVideoAccess = { actor: VsActor; job: VideoJob; scopeKey: string };
type EvidenceRow = typeof schema.videoVsEvidence.$inferSelect;
type Tx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

function forbidden(): VsPerformanceError {
  return new VsPerformanceError("forbidden", 403);
}

function notFound(): VsPerformanceError {
  return new VsPerformanceError("not_found", 404);
}

function stale(): VsPerformanceError {
  return new VsPerformanceError("stale", 409);
}

export function vsVideoScopeKey(job: Pick<VideoJob, "id" | "groupId">): string {
  return job.groupId ? `group:${job.groupId}` : `job:${job.id}`;
}

function isVsVideoJob(job: VideoJob): boolean {
  return (job.scoreTarget ?? job.category) === "vs-performance" && job.status !== "discarded";
}

export function vsVideoJobReadyForEvidence(job: VideoJob): boolean {
  if (["pending_upload", "pending_approval", "discarded"].includes(job.status)) {
    return false;
  }
  return (
    job.approvedAt != null ||
    (job.parseSessionId != null &&
      ["ready", "review", "complete"].includes(job.status))
  );
}

export async function resolveVsVideoAccess(
  sessionId: string,
  jobId: string,
  mode: "read" | "upload" | "review",
): Promise<VsVideoAccess> {
  const access = await resolveVideoJobAccess(
    jobId,
    sessionId,
    mode === "read" ? "read" : "mutate",
  );
  if (!access.ok) {
    throw access.status === 404 ? notFound() : forbidden();
  }
  const job = access.job;
  if (!isVsVideoJob(job)) throw notFound();

  const session = await loadSession(sessionId);
  if (!session?.hqUserId) throw forbidden();

  const allianceId = await resolveHqAllianceIdFromStoredAllianceId(job.allianceId);
  if (!allianceId) throw forbidden();
  const activeAlliance = session.currentAllianceId ?? session.allianceId;
  if (activeAlliance !== allianceId) throw forbidden();

  const permission =
    mode === "read"
      ? "scores:read"
      : mode === "review"
        ? "trains:write"
        : "hq:video:enqueue";
  if (!(await sessionHasPermissionForAlliance(sessionId, allianceId, permission))) {
    throw forbidden();
  }

  return {
    actor: { sessionId, hqUserId: session.hqUserId, allianceId },
    job,
    scopeKey: vsVideoScopeKey(job),
  };
}

async function loadRow(
  access: VsVideoAccess,
): Promise<EvidenceRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.videoVsEvidence)
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
      ),
    )
    .limit(1);
  return row;
}

export async function loadVsVideoEvidenceRow(
  access: VsVideoAccess,
): Promise<EvidenceRow | undefined> {
  return loadRow(access);
}

export function vsVideoDefaultContext(job: VideoJob): VsVideoContext {
  return defaultContext(job);
}

async function loadRowForUpdate(
  tx: Tx,
  access: VsVideoAccess,
): Promise<EvidenceRow | undefined> {
  const [row] = await tx
    .select()
    .from(schema.videoVsEvidence)
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

function defaultContext(job: VideoJob): VsVideoContext {
  const recordedDate = job.recordedDate?.trim().slice(0, 10);
  if (recordedDate && validateVsPeriod(recordedDate, "weekly")) {
    return { recordedDate, period: "weekly" };
  }
  if (recordedDate && validateVsPeriod(recordedDate, "daily")) {
    return { recordedDate, period: "daily" };
  }
  return {
    recordedDate: defaultVsPerformanceRecordedDate("daily"),
    period: "daily",
  };
}

export async function initializeVsVideoEvidence(
  jobId: string,
  sessionId: string,
  context?: VsVideoContext,
): Promise<void> {
  let access: VsVideoAccess;
  try {
    access = await resolveVsVideoAccess(sessionId, jobId, "upload");
  } catch (error) {
    if (error instanceof VsPerformanceError && error.code === "not_found") {
      return;
    }
    throw error;
  }
  const resolved = vsVideoContextSchema.parse(
    context ?? defaultContext(access.job),
  );
  await getDb()
    .insert(schema.videoVsEvidence)
    .values({
      scopeKey: access.scopeKey,
      jobId: access.job.id,
      allianceId: access.actor.allianceId,
      recordedDate: resolved.recordedDate,
      period: resolved.period,
      updatedByHqUserId: access.actor.hqUserId,
    })
    .onConflictDoNothing({ target: schema.videoVsEvidence.scopeKey });
}

async function buildResponse(
  access: VsVideoAccess,
  row: EvidenceRow | null,
): Promise<VsVideoEvidenceResponse> {
  const context: VsVideoContext = row
    ? { recordedDate: row.recordedDate, period: row.period }
    : defaultContext(access.job);
  const weekStart = vsVideoWeekStart(context);
  const db = getDb();
  const [matchup, canEditMatch, canAttach, canWriteScores, allianceRow] =
    await Promise.all([
      loadVsMatchup(access.actor.allianceId, weekStart, db, access.actor),
      sessionHasPermissionForAlliance(
        access.actor.sessionId,
        access.actor.allianceId,
        "trains:write",
      ),
      sessionHasPermissionForAlliance(
        access.actor.sessionId,
        access.actor.allianceId,
        "hq:video:enqueue",
      ),
      sessionHasPermissionForAlliance(
        access.actor.sessionId,
        access.actor.allianceId,
        "scores:write",
      ),
      db
        .select({
          tag: schema.alliances.tag,
          name: schema.alliances.name,
          server: schema.alliances.gameServerNumber,
          operatingMode: schema.alliances.operatingMode,
          ashedAllianceId: schema.alliances.ashedAllianceId,
        })
        .from(schema.alliances)
        .where(eq(schema.alliances.id, access.actor.allianceId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
  const ashedLinked =
    !!allianceRow?.ashedAllianceId &&
    allianceRow.operatingMode !== "native";
  const [canImportAshed, scoreScope] = await Promise.all([
    ashedLinked ? vsAshedSyncEligibility(access.actor) : false,
    ashedLinked
      ? db
          .select()
          .from(schema.vsScoreSyncScopes)
          .where(
            and(
              eq(schema.vsScoreSyncScopes.allianceId, access.actor.allianceId),
              eq(schema.vsScoreSyncScopes.recordedDate, context.recordedDate),
              eq(schema.vsScoreSyncScopes.period, context.period),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null,
  ]);
  const scoreSyncStatuses = new Set([
    "idle",
    "pending",
    "synced",
    "failed",
    "credentials_required",
  ]);
  const scoreSync: VsVideoEvidenceResponse["scoreSync"] = !ashedLinked
    ? { status: "local", lastSyncedAt: null }
    : !scoreScope
      ? { status: "idle", lastSyncedAt: null }
      : scoreScope.status === "synced" &&
          scoreScope.requestedVersion > scoreScope.processedVersion
        ? {
            status: "pending",
            lastSyncedAt: scoreScope.lastSyncedAt?.toISOString() ?? null,
          }
        : {
            status: scoreSyncStatuses.has(scoreScope.status)
              ? (scoreScope.status as
                  | "idle"
                  | "pending"
                  | "synced"
                  | "failed"
                  | "credentials_required")
              : "failed",
            lastSyncedAt: scoreScope.lastSyncedAt?.toISOString() ?? null,
          };
  return {
    evidence: {
      ...context,
      version: row?.version ?? 0,
      imageVersion: row?.imageVersion ?? 0,
      requestedKind: row?.requestedKind ?? "auto",
      status: row?.status ?? EVIDENCE_STATUS.none,
      fileName: row?.fileName ?? null,
      candidate: (row?.candidate as VsCaptureCandidate | null) ?? null,
      errorCode: row?.errorCode ?? null,
      draft: row?.draft ?? null,
      appliedImageVersion: row?.appliedImageVersion ?? null,
      previewUrl: (() => {
        if (!row?.storageKey) return null;
        const kind =
          (row.candidate as VsCaptureCandidate | null)?.kind ??
          (row.requestedKind !== "auto" ? row.requestedKind : null);
        if (kind == null) return null;
        return `/api/tools/video-upload/${encodeURIComponent(access.job.id)}/vs-evidence/image?imageVersion=${row.imageVersion}`;
      })(),
    },
    canEditMatch,
    canAttach,
    canWriteScores,
    canProcessImage: canEditMatch && vsVideoJobReadyForEvidence(access.job),
    draftIsOwn:
      row?.draft != null && row.updatedByHqUserId === access.actor.hqUserId,
    today: getServerCalendarDate(),
    ashedLinked,
    canImportAshed,
    scoreSync,
    scope: vsScope(access.actor, weekStart),
    contextScope: vsContextScope(access.actor),
    matchup,
    alliance: {
      tag: allianceRow?.tag ?? null,
      name: allianceRow?.name ?? null,
      server: allianceRow?.server ?? null,
    },
  };
}

export async function loadVsVideoEvidence(
  access: VsVideoAccess,
): Promise<VsVideoEvidenceResponse> {
  return buildResponse(access, (await loadRow(access)) ?? null);
}

async function insertRow(
  tx: Tx,
  access: VsVideoAccess,
  context: VsVideoContext,
  extra?: Partial<typeof schema.videoVsEvidence.$inferInsert>,
): Promise<void> {
  const inserted = await tx
    .insert(schema.videoVsEvidence)
    .values({
      scopeKey: access.scopeKey,
      jobId: access.job.id,
      allianceId: access.actor.allianceId,
      recordedDate: context.recordedDate,
      period: context.period,
      updatedByHqUserId: access.actor.hqUserId,
      ...extra,
    })
    .onConflictDoNothing({ target: schema.videoVsEvidence.scopeKey })
    .returning({ scopeKey: schema.videoVsEvidence.scopeKey });
  if (inserted.length === 0) throw stale();
}

const patchBodySchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    context: vsVideoContextSchema.optional(),
    requestedKind: vsVideoRequestedKindSchema.optional(),
    draft: vsVideoDraftSchema.nullable().optional(),
  })
  .strict();

export async function updateVsVideoEvidence(
  access: VsVideoAccess,
  input: unknown,
): Promise<VsVideoEvidenceResponse> {
  const body = patchBodySchema.parse(input);
  const db = getDb();
  let requeue = false;
  const row = await db.transaction(async (tx) => {
    let row = await loadRowForUpdate(tx, access);
    if (!row) {
      if (body.expectedVersion !== 0) throw stale();
      const context = body.context ?? defaultContext(access.job);
      const draft = "draft" in body ? (body.draft ?? null) : null;
      await insertRow(tx, access, context, {
        requestedKind: body.requestedKind ?? "auto",
        draft,
      });
      const inserted = (await loadRowForUpdate(tx, access))!;
      if ("draft" in body) {
        await tx.insert(schema.auditLog).values({
          id: nanoid(),
          sessionId: access.actor.sessionId,
          allianceId: access.actor.allianceId,
          hqUserId: access.actor.hqUserId,
          action: "vs.video_review_draft",
          severity: "routine",
          resourceType: "video_job",
          resourceId: access.job.id,
          metadata: {
            permission: "trains:write",
            version: inserted.version,
            imageVersion: inserted.imageVersion,
            hasDraft: body.draft != null,
          },
        });
      }
      return inserted;
    }
    if (row.version !== body.expectedVersion) throw stale();
    const contextChanged =
      body.context != null &&
      (body.context.recordedDate !== row.recordedDate ||
        body.context.period !== row.period);
    const kindChanged =
      body.requestedKind != null && body.requestedKind !== row.requestedKind;
    if ((contextChanged || kindChanged) && body.draft != null) {
      throw new VsPerformanceError("invalid", 400);
    }
    const patch: Record<string, unknown> = {};
    if (contextChanged || kindChanged) {
      patch.draft = null;
      patch.appliedImageVersion = null;
      patch.errorCode = null;
      patch.imageVersion = row.imageVersion + 1;
      patch.leaseToken = null;
      patch.leaseExpiresAt = null;
      if (row.status === EVIDENCE_STATUS.uploading) {
        patch.status = EVIDENCE_STATUS.none;
        patch.uploadKey = null;
        patch.storageKey = null;
        patch.imageSha256 = null;
        patch.fileName = null;
        patch.contentType = null;
        patch.fileSize = null;
        patch.candidate = null;
      } else if (kindChanged || (row.status === EVIDENCE_STATUS.running && row.storageKey)) {
        patch.candidate = null;
        if (row.storageKey) {
          patch.status = EVIDENCE_STATUS.queued;
          requeue = true;
        }
      }
    }
    if (contextChanged) {
      patch.recordedDate = body.context!.recordedDate;
      patch.period = body.context!.period;
    }
    if (kindChanged) {
      patch.requestedKind = body.requestedKind;
    }
    if ("draft" in body) {
      const draft = body.draft;
      if (draft != null) {
        const expected = draft.submission?.evidenceVersion;
        if (expected != null && expected !== row.version) throw stale();
      }
      patch.draft = draft ?? null;
    }
    if (Object.keys(patch).length > 0) {
      patch.version = row.version + 1;
      patch.updatedByHqUserId = access.actor.hqUserId;
      patch.updatedAt = new Date();
      await tx
        .update(schema.videoVsEvidence)
        .set(patch)
        .where(
          and(
            eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
            eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
          ),
        );
      row = { ...row, ...(patch as Partial<EvidenceRow>) };
    }
    if ("draft" in body) {
      await tx.insert(schema.auditLog).values({
        id: nanoid(),
        sessionId: access.actor.sessionId,
        allianceId: access.actor.allianceId,
        hqUserId: access.actor.hqUserId,
        action: "vs.video_review_draft",
        severity: "routine",
        resourceType: "video_job",
        resourceId: access.job.id,
        metadata: {
          permission: "trains:write",
          version: row.version,
          imageVersion: row.imageVersion,
          hasDraft: body.draft != null,
        },
      });
    }
    return row;
  });
  if (requeue && vsVideoJobReadyForEvidence(access.job)) {
    const { dispatchVsVideoEvidence } = await import(
      "@/lib/vs-performance/video-evidence-dispatch.server"
    );
    void dispatchVsVideoEvidence(access.job.id);
  }
  return buildResponse(access, row);
}

const uploadInitBodySchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    fileName: z.string().min(1).max(160),
    fileSize: z.number().int().positive().max(MAX_SCREENSHOT_UPLOAD_BYTES),
    contentType: z.enum(["image/png", "image/jpeg"]),
    requestedKind: vsVideoRequestedKindSchema.optional(),
  })
  .strict();

function newImageKeys(jobId: string): { incoming: string; sealed: string } {
  const base = `videos/${jobId}/vs-match/${nanoid(21)}`;
  return { incoming: `${base}/incoming`, sealed: `${base}/sealed` };
}

export async function beginVsVideoImageUpload(
  access: VsVideoAccess,
  input: unknown,
): Promise<{
  mode: "r2_put" | "direct";
  putUrl?: string;
  imageVersion: number;
  version: number;
  contentType: string;
}> {
  const body = uploadInitBodySchema.parse(input);
  const keys = newImageKeys(access.job.id);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    let row = await loadRowForUpdate(tx, access);
    if (!row) {
      if (body.expectedVersion !== 0) throw stale();
      await insertRow(tx, access, defaultContext(access.job));
      row = await loadRowForUpdate(tx, access);
      if (!row) throw stale();
    } else if (row.version !== body.expectedVersion) {
      throw stale();
    }
    const imageVersion = row.imageVersion + 1;
    const version = row.version + 1;
    await tx
      .update(schema.videoVsEvidence)
      .set({
        version,
        imageVersion,
        status: EVIDENCE_STATUS.uploading,
        fileName: body.fileName,
        contentType: body.contentType,
        fileSize: body.fileSize,
        uploadKey: keys.incoming,
        storageKey: null,
        imageSha256: null,
        candidate: null,
        draft: null,
        errorCode: null,
        appliedImageVersion: null,
        leaseToken: null,
        leaseExpiresAt: null,
        ...(body.requestedKind ? { requestedKind: body.requestedKind } : {}),
        uploadedByHqUserId: access.actor.hqUserId,
        updatedByHqUserId: access.actor.hqUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
          eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
          eq(schema.videoVsEvidence.version, row.version),
        ),
      );
    return { imageVersion, version };
  });
  const response: {
    mode: "r2_put" | "direct";
    putUrl?: string;
    imageVersion: number;
    version: number;
    contentType: string;
  } = {
    mode: r2Configured() ? "r2_put" : "direct",
    imageVersion: result.imageVersion,
    version: result.version,
    contentType: body.contentType,
  };
  if (response.mode === "r2_put") {
    response.putUrl = await presignR2PutObject(keys.incoming, body.contentType);
  }
  return response;
}

export async function uploadLocalVsVideoImage(
  access: VsVideoAccess,
  imageVersion: number,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  if (r2Configured()) throw new VsPerformanceError("invalid", 400);
  if (!Number.isSafeInteger(imageVersion) || imageVersion <= 0) {
    throw new VsPerformanceError("invalid", 400);
  }
  const row = await loadRow(access);
  if (
    !row ||
    row.status !== EVIDENCE_STATUS.uploading ||
    row.imageVersion !== imageVersion ||
    !row.uploadKey
  ) {
    throw stale();
  }
  try {
    await putLocalObjectStreamBounded(
      row.uploadKey,
      body,
      MAX_SCREENSHOT_UPLOAD_BYTES,
    );
  } catch (error) {
    if (error instanceof RangeError) {
      throw new VsPerformanceError("capture_invalid", 400);
    }
    throw error;
  }
}

function isImageMagic(bytes: Buffer, contentType: string | null): boolean {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (contentType === "image/png") {
    return bytes.length >= png.length && bytes.subarray(0, png.length).equals(png);
  }
  return (
    contentType === "image/jpeg" &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

async function readBoundedBuffer(
  storageKey: string,
  maxBytes: number,
): Promise<Buffer> {
  const web = await getObjectStream(
    storageKey,
    true,
    AbortSignal.timeout(60_000),
  );
  const node = Readable.fromWeb(
    web as import("node:stream/web").ReadableStream,
  );
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of node) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new RangeError("object_size_limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const completeBodySchema = z
  .object({ imageVersion: z.number().int().positive() })
  .strict();

export async function completeVsVideoImageUpload(
  access: VsVideoAccess,
  input: unknown,
): Promise<VsVideoEvidenceResponse> {
  const body = completeBodySchema.parse(input);
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    const row = await loadRowForUpdate(tx, access);
    if (
      !row ||
      row.status !== EVIDENCE_STATUS.uploading ||
      row.imageVersion !== body.imageVersion ||
      !row.uploadKey
    ) {
      throw stale();
    }
    return row;
  });
  const sealedKey = newImageKeys(row.jobId).sealed;
  let bytes: Buffer;
  try {
    await copyObjectBounded(
      row.uploadKey!,
      sealedKey,
      MAX_SCREENSHOT_UPLOAD_BYTES,
    );
    bytes = await readBoundedBuffer(sealedKey, MAX_SCREENSHOT_UPLOAD_BYTES);
  } catch (error) {
    await markUploadFailed(access, row);
    throw error instanceof RangeError
      ? new VsPerformanceError("capture_invalid", 400)
      : error;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    (row.fileSize != null && bytes.length !== row.fileSize) ||
    !isImageMagic(bytes, row.contentType)
  ) {
    await markUploadFailed(access, row);
    throw new VsPerformanceError("capture_invalid", 400);
  }
  const fresh = await resolveVsVideoAccess(
    access.actor.sessionId,
    access.job.id,
    "upload",
  );
  if (
    fresh.scopeKey !== access.scopeKey ||
    fresh.actor.allianceId !== access.actor.allianceId ||
    fresh.job.id !== access.job.id
  ) {
    throw new VsPerformanceError("forbidden", 403);
  }
  const [updated] = await db
    .update(schema.videoVsEvidence)
    .set({
      storageKey: sealedKey,
      imageSha256: sha256,
      status: EVIDENCE_STATUS.queued,
      version: sql`${schema.videoVsEvidence.version} + 1`,
      updatedByHqUserId: access.actor.hqUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
        eq(schema.videoVsEvidence.status, EVIDENCE_STATUS.uploading),
        eq(schema.videoVsEvidence.imageVersion, body.imageVersion),
      ),
    )
    .returning({ scopeKey: schema.videoVsEvidence.scopeKey });
  if (!updated) throw stale();
  if (vsVideoJobReadyForEvidence(access.job)) {
    const { dispatchVsVideoEvidence } = await import(
      "@/lib/vs-performance/video-evidence-dispatch.server"
    );
    void dispatchVsVideoEvidence(access.job.id);
  }
  return buildResponse(access, (await loadRow(access)) ?? null);
}

async function markUploadFailed(
  access: VsVideoAccess,
  row: EvidenceRow,
): Promise<void> {
  await getDb()
    .update(schema.videoVsEvidence)
    .set({
      status: EVIDENCE_STATUS.failed,
      errorCode: "capture_invalid",
      version: sql`${schema.videoVsEvidence.version} + 1`,
      updatedByHqUserId: access.actor.hqUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
        eq(schema.videoVsEvidence.status, EVIDENCE_STATUS.uploading),
        eq(schema.videoVsEvidence.imageVersion, row.imageVersion),
      ),
    );
}

export async function removeVsVideoImage(
  access: VsVideoAccess,
  expectedVersion: number,
): Promise<VsVideoEvidenceResponse> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new VsPerformanceError("invalid", 400);
  }
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    const row = await loadRowForUpdate(tx, access);
    if (!row || row.version !== expectedVersion) throw stale();
    await tx
      .update(schema.videoVsEvidence)
      .set({
        version: row.version + 1,
        imageVersion: row.imageVersion + 1,
        status: EVIDENCE_STATUS.none,
        fileName: null,
        contentType: null,
        fileSize: null,
        uploadKey: null,
        storageKey: null,
        imageSha256: null,
        candidate: null,
        draft: null,
        errorCode: null,
        appliedImageVersion: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedByHqUserId: access.actor.hqUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
          eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
          eq(schema.videoVsEvidence.version, expectedVersion),
        ),
      );
    return loadRowForUpdate(tx, access);
  });
  return buildResponse(access, row ?? null);
}

export async function requeueVsVideoEvidence(
  access: VsVideoAccess,
): Promise<void> {
  await getDb()
    .update(schema.videoVsEvidence)
    .set({
      status: EVIDENCE_STATUS.queued,
      candidate: null,
      errorCode: null,
      leaseToken: null,
      leaseExpiresAt: null,
      version: sql`${schema.videoVsEvidence.version} + 1`,
      updatedByHqUserId: access.actor.hqUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
        inArray(schema.videoVsEvidence.status, ["ready", "needs_type", "failed"]),
        isNotNull(schema.videoVsEvidence.storageKey),
        isNotNull(schema.videoVsEvidence.imageSha256),
      ),
    );
}

export async function getVsVideoImage(
  access: VsVideoAccess,
  expectedImageVersion?: number,
): Promise<{
  stream: ReadableStream<Uint8Array>;
  kind: VsCaptureKind;
  imageVersion: number;
}> {
  const row = await loadRow(access);
  if (!row?.storageKey || row.status === EVIDENCE_STATUS.none) throw notFound();
  const kind =
    (row.candidate as VsCaptureCandidate | null)?.kind ??
    (row.requestedKind !== "auto" ? (row.requestedKind as VsCaptureKind) : null);
  if (kind == null) throw notFound();
  if (
    expectedImageVersion != null &&
    expectedImageVersion !== row.imageVersion
  ) {
    throw stale();
  }
  const stream = await getObjectStream(row.storageKey, true, AbortSignal.timeout(60_000));
  return { stream, kind, imageVersion: row.imageVersion };
}
