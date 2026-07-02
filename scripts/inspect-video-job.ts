/**
 * Read-only video job diagnostics for ops / debugging.
 *
 * Usage (local Postgres):
 *   npx tsx scripts/inspect-video-job.ts <jobId>
 *
 * Usage (production Neon — unset LOCAL so DATABASE_URL wins):
 *   LOCAL_DATABASE_URL= npx tsx scripts/inspect-video-job.ts <jobId>
 *
 * Or pass an explicit URL (not logged):
 *   DATABASE_URL='postgresql://…' LOCAL_DATABASE_URL= npx tsx scripts/inspect-video-job.ts <jobId>
 */

import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";

config({ path: ".env.local" });
config();

import { getDb, schema } from "@/lib/db";

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: npx tsx scripts/inspect-video-job.ts <jobId>");
  process.exit(1);
}

function summarizeOcrRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw ?? null;
  const obj = raw as Record<string, unknown>;
  const unwrapped =
    obj.output && typeof obj.output === "object"
      ? (obj.output as Record<string, unknown>)
      : obj.data && typeof obj.data === "object"
        ? (obj.data as Record<string, unknown>)
        : obj;
  const members =
    unwrapped.members ?? unwrapped.entries ?? unwrapped.players;
  return {
    topLevelKeys: Object.keys(obj),
    unwrappedKeys: Object.keys(unwrapped),
    membersIsArray: Array.isArray(members),
    membersLength: Array.isArray(members) ? members.length : null,
    firstMemberKeys:
      Array.isArray(members) && members[0] && typeof members[0] === "object"
        ? Object.keys(members[0] as object)
        : null,
  };
}

async function main() {
  const db = getDb();

  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    console.log("JOB_NOT_FOUND");
    return;
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

  let alliance: {
    videoHqOcrOnly: number;
    tag: string | null;
    name: string | null;
  } | null = null;
  if (job.allianceId) {
    const [row] = await db
      .select({
        videoHqOcrOnly: schema.alliances.videoHqOcrOnly,
        tag: schema.alliances.tag,
        name: schema.alliances.name,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, job.allianceId))
      .limit(1);
    alliance = row ?? null;
  }

  const timings = job.timingsJson as Record<string, unknown> | null;

  console.log(
    JSON.stringify(
      {
        job: {
          id: job.id,
          status: job.status,
          scoreTarget: job.scoreTarget,
          fileName: job.fileName,
          fileSizeBytes: job.fileSizeBytes,
          frameCount: job.frameCount,
          errorMessage: job.errorMessage,
          sessionId: job.sessionId,
          processingSessionId: job.processingSessionId,
          allianceId: job.allianceId,
          passKey: job.passKey,
          passRole: job.passRole,
          approvedAt: job.approvedAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
        alliance,
        ocrEngineHint: alliance?.videoHqOcrOnly
          ? "native (video_hq_ocr_only)"
          : "ashed (default prod)",
        timingsSummary: timings
          ? {
              frameCount: timings.frameCount,
              rowCount: timings.rowCount,
              matchedCount: timings.matchedCount,
              totalRawOcrRows: timings.totalRawOcrRows,
              totalMs: timings.totalMs,
              phases: timings.phases,
            }
          : null,
        uploaderVsProcessorSameSession:
          job.processingSessionId == null ||
          job.sessionId === job.processingSessionId,
        frameSummary: {
          count: frames.length,
          totalOcrEntries: frames.reduce(
            (sum, f) => sum + (f.ocrEntryCount ?? 0),
            0,
          ),
          framesWithErrors: frames.filter((f) => f.ocrError).length,
          frames,
        },
        firstFrameRawSample: summarizeOcrRaw(firstRaw?.ocrRawJson),
        parseSessions: sessions.map((s) => ({
          id: s.id,
          rowCount: s.rowCount,
          matchedCount: s.matchedCount,
          status: s.status,
        })),
        parsedRowsInDb,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
