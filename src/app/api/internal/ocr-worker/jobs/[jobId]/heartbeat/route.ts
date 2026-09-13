import { NextResponse } from "next/server";
import { readOcrJson } from "@/lib/ocr/learning/api.server";
import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { heartbeatWorkerJob } from "@/lib/ocr/learning/control-leases.server";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { jobId } = await context.params;
    await readOcrJson(request);
    return NextResponse.json(await heartbeatWorkerJob(jobId, workerLeaseToken(request)));
  });
}
