import "server-only";

import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { and, eq, gt, isNotNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { VideoJob } from "@/lib/db/schema";
import { MAX_SCREENSHOT_UPLOAD_BYTES } from "@/lib/ocr/screenshot-upload.shared";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { loadSession } from "@/lib/session";
import { getObjectStream } from "@/lib/storage";
import { sessionCanProcessVideoForAlliance } from "@/lib/video/processor-slots.server";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";
import { resolveVideoJobAccess } from "@/lib/video/video-job-access.server";
import type { VsActor } from "@/lib/vs-performance/weekly-view.shared";
import {
  vsVideoJobReadyForEvidence,
  vsVideoScopeKey,
} from "@/lib/vs-performance/video-evidence.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

const LEASE_MS = 5 * 60 * 1000;

type EvidenceRow = typeof schema.videoVsEvidence.$inferSelect;

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

function currentAllianceId(session: {
  currentAllianceId?: string | null;
  allianceId?: string | null;
}): string | null {
  return session.currentAllianceId ?? session.allianceId ?? null;
}

async function processingActorAllowed(
  job: VideoJob,
  allianceId: string,
  actorOverride?: VsActor,
): Promise<boolean> {
  if (actorOverride) {
    const session = await loadSession(actorOverride.sessionId);
    if (
      !session?.hqUserId ||
      session.hqUserId !== actorOverride.hqUserId ||
      session.expiresAt <= new Date() ||
      currentAllianceId(session) !== allianceId
    ) {
      return false;
    }
    const access = await resolveVideoJobAccess(
      job.id,
      actorOverride.sessionId,
      "mutate",
    );
    if (!access.ok) return false;
    return sessionHasPermissionForAlliance(
      actorOverride.sessionId,
      allianceId,
      "trains:write",
    );
  }
  const sessionId = job.processingSessionId ?? job.sessionId;
  if (!sessionId) return false;
  const session = await loadSession(sessionId);
  if (
    !session?.hqUserId ||
    session.expiresAt <= new Date() ||
    currentAllianceId(session) !== allianceId
  ) {
    return false;
  }
  return sessionCanProcessVideoForAlliance(session.id, allianceId);
}

async function loadJob(jobId: string): Promise<VideoJob | null> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);
  return job ?? null;
}

export async function processVsVideoEvidence(
  jobId: string,
  actorOverride?: VsActor,
): Promise<void> {
  const db = getDb();
  const job = await loadJob(jobId);
  if (!job || (job.scoreTarget ?? job.category) !== "vs-performance") return;
  if (!vsVideoJobReadyForEvidence(job)) return;

  const allianceId = await resolveHqAllianceIdFromStoredAllianceId(
    job.allianceId,
  );
  if (!allianceId) return;
  if (!(await processingActorAllowed(job, allianceId, actorOverride))) return;

  const scopeKey = vsVideoScopeKey(job);
  const leaseToken = nanoid(21);
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
  const now = new Date();
  const [claimed] = await db
    .update(schema.videoVsEvidence)
    .set({
      status: "running",
      leaseToken,
      leaseExpiresAt,
      errorCode: null,
      version: sql`${schema.videoVsEvidence.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, scopeKey),
        eq(schema.videoVsEvidence.allianceId, allianceId),
        isNotNull(schema.videoVsEvidence.storageKey),
        isNotNull(schema.videoVsEvidence.imageSha256),
        or(
          eq(schema.videoVsEvidence.status, "queued"),
          and(
            eq(schema.videoVsEvidence.status, "running"),
            lt(schema.videoVsEvidence.leaseExpiresAt, now),
          ),
        ),
      ),
    )
    .returning();
  if (!claimed) return;

  const stillPublishable = async (): Promise<boolean> => {
    const current = await loadJob(jobId);
    if (!current || !vsVideoJobReadyForEvidence(current)) return false;
    const currentAllianceId = await resolveHqAllianceIdFromStoredAllianceId(
      current.allianceId,
    );
    if (currentAllianceId !== allianceId) return false;
    if (vsVideoScopeKey(current) !== scopeKey) return false;
    return processingActorAllowed(current, allianceId, actorOverride);
  };

  const finish = async (patch: Partial<EvidenceRow>) => {
    if (!(await stillPublishable())) return;
    await db
      .update(schema.videoVsEvidence)
      .set({
        ...patch,
        leaseToken: null,
        leaseExpiresAt: null,
        version: sql`${schema.videoVsEvidence.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.videoVsEvidence.scopeKey, scopeKey),
          eq(schema.videoVsEvidence.allianceId, allianceId),
          eq(schema.videoVsEvidence.status, "running"),
          eq(schema.videoVsEvidence.imageVersion, claimed.imageVersion),
          eq(schema.videoVsEvidence.leaseToken, leaseToken),
          gt(schema.videoVsEvidence.leaseExpiresAt, new Date()),
        ),
      );
  };

  try {
    const bytes = await readBoundedBuffer(
      claimed.storageKey!,
      MAX_SCREENSHOT_UPLOAD_BYTES,
    );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== claimed.imageSha256) {
      await finish({ status: "failed", errorCode: "capture_invalid" });
      return;
    }
    const { parseVsCaptureImageAuto } = await import(
      "@/lib/vs-performance/vs-capture-ocr.server"
    );
    const candidate = await parseVsCaptureImageAuto(
      bytes,
      claimed.requestedKind,
    );
    await finish({ status: "ready", candidate, errorCode: null });
  } catch (error) {
    const code =
      error instanceof VsPerformanceError ? error.code : "capture_failed";
    await finish({
      status: code === "capture_kind_unknown" ? "needs_type" : "failed",
      errorCode: code,
    });
  }
}
