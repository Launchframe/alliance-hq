import { NextResponse } from "next/server";
import { OcrLearningError } from "@/lib/ocr/benchmark/types.shared";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { cancelWorkerJob, loadWorkerJob } from "@/lib/ocr/learning/control-jobs.server";

type Context = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrAdmin(async () => {
    const { jobId } = await context.params;
    const job = await loadWorkerJob(ocrScope(request), jobId);
    return NextResponse.json({ id: job.id, kind: job.kind, scoreTarget: job.scoreTarget, datasetId: job.datasetId, pipelineId: job.pipelineId, state: job.state, errorCode: job.errorCode, attempts: job.attempts, result: job.result, metrics: job.metrics, expiresAt: job.expiresAt, createdAt: job.createdAt });
  });
}

export async function DELETE(request: Request, context: Context) {
  return withOcrAdmin(async (actor) => {
    const { jobId } = await context.params;
    const body = await readOcrJson(request);
    if (body.confirmed !== true) throw new OcrLearningError("confirmation_required");
    return NextResponse.json(await cancelWorkerJob(ocrScope(request), jobId, actor));
  });
}
