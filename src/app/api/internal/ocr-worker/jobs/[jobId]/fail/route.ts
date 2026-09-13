import { NextResponse } from "next/server";
import { readOcrJson } from "@/lib/ocr/learning/api.server";
import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { failWorkerJob } from "@/lib/ocr/learning/control-leases.server";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { jobId } = await context.params;
    const body = await readOcrJson(request);
    return NextResponse.json(await failWorkerJob(jobId, workerLeaseToken(request), typeof body.code === "string" ? body.code : "worker_failed"));
  });
}
