import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  buildVideoJobInspectHints,
  resolveVideoJobOcrEngineHint,
  summarizeOcrRaw,
  type VideoJobInspectReport,
} from "@/lib/video/video-job-inspect.shared";

export async function loadVideoJobInspectReport(
  jobId: string,
): Promise<VideoJobInspectReport | null> {
  const db = getDb();

  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return null;
  }

  const frames = await db
    .select({
      frameIndex: schema.videoFrames.frameIndex,
      ocrEntryCount: schema.videoFrames.ocrEntryCount,
      ocrError: schema.videoFrames.ocrError,
      uploadMs: schema.videoFrames.uploadMs,
      extractMs: schema.videoFrames.extractMs,
      hasRaw: sql<boolean>`ocr_raw_json IS NOT NULL`,
    })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, jobId))
    .orderBy(schema.videoFrames.frameIndex);

  const [firstRaw] = await db
    .select({ ocrRawJson: schema.videoFrames.ocrRawJson })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, jobId))
    .orderBy(schema.videoFrames.frameIndex)
    .limit(1);

  const sessions = await db
    .select()
    .from(schema.parseSessions)
    .where(eq(schema.parseSessions.jobId, jobId));

  let parsedRowsInDb = 0;
  if (sessions[0]) {
    const [rc] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, sessions[0].id));
    parsedRowsInDb = rc?.c ?? 0;
  }

  let alliance: VideoJobInspectReport["alliance"] = null;
  if (job.allianceId) {
    const [row] = await db
      .select({
        videoHqOcrOnly: schema.alliances.videoHqOcrOnly,
        tag: schema.alliances.tag,
        name: schema.alliances.name,
        operatingMode: schema.alliances.operatingMode,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, job.allianceId))
      .limit(1);
    alliance = row ?? null;
  }

  const timings = job.timingsJson as Record<string, unknown> | null;
  const timingsSummary = timings
    ? {
        frameCount: timings.frameCount,
        rowCount: timings.rowCount,
        matchedCount: timings.matchedCount,
        totalRawOcrRows: timings.totalRawOcrRows,
        totalMs: timings.totalMs,
        phases: timings.phases,
      }
    : null;

  const totalOcrEntries = frames.reduce(
    (sum, frame) => sum + (frame.ocrEntryCount ?? 0),
    0,
  );

  const ocrEngineHint = resolveVideoJobOcrEngineHint(
    alliance?.videoHqOcrOnly,
  );

  const report: VideoJobInspectReport = {
    job: {
      id: job.id,
      status: job.status,
      scoreTarget: job.scoreTarget,
      fileName: job.fileName,
      fileSizeBytes: job.fileSizeBytes,
      frameCount: job.frameCount,
      uploadedFrameCount: job.uploadedFrameCount,
      errorMessage: job.errorMessage,
      sessionId: job.sessionId,
      processingSessionId: job.processingSessionId,
      allianceId: job.allianceId,
      passKey: job.passKey,
      passRole: job.passRole,
      approvedAt: job.approvedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    },
    alliance,
    ocrEngineHint,
    timingsSummary,
    uploaderVsProcessorSameSession:
      job.processingSessionId == null ||
      job.sessionId === job.processingSessionId,
    frameSummary: {
      count: frames.length,
      totalOcrEntries,
      framesWithErrors: frames.filter((frame) => frame.ocrError).length,
      frames,
    },
    firstFrameRawSample: summarizeOcrRaw(firstRaw?.ocrRawJson),
    parseSessions: sessions.map((session) => ({
      id: session.id,
      rowCount: session.rowCount,
      matchedCount: session.matchedCount,
      status: session.status,
    })),
    parsedRowsInDb,
    hints: [],
  };

  report.hints = buildVideoJobInspectHints({
    status: report.job.status,
    errorMessage: report.job.errorMessage,
    frameCount: report.frameSummary.count,
    totalOcrEntries: report.frameSummary.totalOcrEntries,
    timingsSummary: report.timingsSummary,
    ocrEngineHint: report.ocrEngineHint,
    parsedRowsInDb: report.parsedRowsInDb,
    approvedAt: report.job.approvedAt,
    updatedAt: report.job.updatedAt,
  });

  return report;
}
