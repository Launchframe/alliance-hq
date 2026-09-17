import { NextResponse } from "next/server";
import { readOcrJson } from "@/lib/ocr/learning/api.server";
import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { reserveWorkerArtifact } from "@/lib/ocr/learning/control-artifacts.server";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { jobId } = await context.params;
    const body = await readOcrJson(request);
    return NextResponse.json(await reserveWorkerArtifact(jobId, workerLeaseToken(request), body as Parameters<typeof reserveWorkerArtifact>[2]));
  });
}
