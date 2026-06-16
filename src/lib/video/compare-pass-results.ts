import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type PassComparison = {
  computedAt: string;
  passes: Array<{
    jobId: string;
    passKey: string | null;
    passRole: string | null;
    rowCount: number;
    matchedCount: number;
    frameCount: number | null;
    totalMs: number | null;
  }>;
  overlapCount: number;
  onlyInPrimary: number;
  onlyInShadow: number;
  recommendedJobId: string | null;
};

export async function computePassComparison(
  primaryJobId: string,
  shadowJobId: string,
): Promise<PassComparison> {
  const db = getDb();

  async function getJobRows(jobId: string) {
    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);
    if (!job?.parseSessionId) return { job: job ?? null, rows: [] };

    const rows = await db
      .select({
        memberId: schema.parsedRows.memberId,
        ocrName: schema.parsedRows.ocrName,
        deleted: schema.parsedRows.deleted,
      })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));

    return { job, rows };
  }

  const [primaryData, shadowData] = await Promise.all([
    getJobRows(primaryJobId),
    getJobRows(shadowJobId),
  ]);

  function rowKey(row: { memberId: string | null; ocrName: string }): string {
    return row.memberId ?? row.ocrName.toLowerCase().trim();
  }

  const primaryKeys = new Set(
    (primaryData.rows ?? [])
      .filter((r) => !r.deleted)
      .map(rowKey),
  );
  const shadowKeys = new Set(
    (shadowData.rows ?? [])
      .filter((r) => !r.deleted)
      .map(rowKey),
  );

  const overlapCount = [...primaryKeys].filter((k) => shadowKeys.has(k)).length;
  const onlyInPrimary = [...primaryKeys].filter((k) => !shadowKeys.has(k)).length;
  const onlyInShadow = [...shadowKeys].filter((k) => !primaryKeys.has(k)).length;

  const primaryJob = primaryData.job;
  const shadowJob = shadowData.job;
  let recommendedJobId: string | null = null;
  if (primaryJob && shadowJob) {
    const primaryMatched = primaryJob.parseSessionId
      ? (primaryData.rows ?? []).filter((r) => !r.deleted && r.memberId).length
      : 0;
    const shadowMatched = shadowJob.parseSessionId
      ? (shadowData.rows ?? []).filter((r) => !r.deleted && r.memberId).length
      : 0;

    if (shadowKeys.size > primaryKeys.size) {
      recommendedJobId = shadowJobId;
    } else if (primaryKeys.size > shadowKeys.size) {
      recommendedJobId = primaryJobId;
    } else {
      recommendedJobId = shadowMatched >= primaryMatched ? shadowJobId : primaryJobId;
    }
  }

  function getTimingsMs(job: typeof primaryData.job): number | null {
    const t = job?.timingsJson as { totalMs?: number } | null;
    return t?.totalMs ?? null;
  }

  return {
    computedAt: new Date().toISOString(),
    passes: [
      {
        jobId: primaryJobId,
        passKey: primaryJob?.passKey ?? null,
        passRole: primaryJob?.passRole ?? null,
        rowCount: primaryKeys.size,
        matchedCount: (primaryData.rows ?? []).filter((r) => !r.deleted && r.memberId).length,
        frameCount: primaryJob?.frameCount ?? null,
        totalMs: getTimingsMs(primaryJob),
      },
      {
        jobId: shadowJobId,
        passKey: shadowJob?.passKey ?? null,
        passRole: shadowJob?.passRole ?? null,
        rowCount: shadowKeys.size,
        matchedCount: (shadowData.rows ?? []).filter((r) => !r.deleted && r.memberId).length,
        frameCount: shadowJob?.frameCount ?? null,
        totalMs: getTimingsMs(shadowJob),
      },
    ],
    overlapCount,
    onlyInPrimary,
    onlyInShadow,
    recommendedJobId,
  };
}
