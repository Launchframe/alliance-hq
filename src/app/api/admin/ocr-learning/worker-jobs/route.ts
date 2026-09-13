import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { createWorkerJob } from "@/lib/ocr/learning/control-jobs.server";
import type { WorkerJobRequest } from "@/lib/ocr/learning/control.shared";

export const maxDuration = 300;

export async function GET(request: Request) {
  return withOcrAdmin(async () => {
    const jobs = await getDb().select({ id: schema.ocrWorkerJobs.id, kind: schema.ocrWorkerJobs.kind, scoreTarget: schema.ocrWorkerJobs.scoreTarget, datasetId: schema.ocrWorkerJobs.datasetId, pipelineId: schema.ocrWorkerJobs.pipelineId, state: schema.ocrWorkerJobs.state, errorCode: schema.ocrWorkerJobs.errorCode, attempts: schema.ocrWorkerJobs.attempts, expiresAt: schema.ocrWorkerJobs.expiresAt, createdAt: schema.ocrWorkerJobs.createdAt }).from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.allianceId, ocrScope(request))).orderBy(desc(schema.ocrWorkerJobs.createdAt)).limit(200);
    return NextResponse.json({ jobs });
  });
}

export async function POST(request: Request) {
  return withOcrAdmin(async (actor) => NextResponse.json(await createWorkerJob(await readOcrJson(request) as WorkerJobRequest, actor), { status: 202 }));
}
