import { NextResponse } from "next/server";
import { readOcrJson } from "@/lib/ocr/learning/api.server";
import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { completeWorkerJob } from "@/lib/ocr/learning/control-results.server";

export const maxDuration = 300;
type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { jobId } = await context.params;
    const body = await readOcrJson(request, 8 * 1024 ** 2);
    return NextResponse.json(await completeWorkerJob(jobId, workerLeaseToken(request), body.output, body.artifactId as string | undefined));
  });
}
