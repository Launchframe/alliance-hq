import { NextResponse } from "next/server";
import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { receiveWorkerArtifact } from "@/lib/ocr/learning/control-artifacts.server";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ artifactId: string }> };

export async function PUT(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { artifactId } = await context.params;
    return NextResponse.json(await receiveWorkerArtifact(artifactId, workerLeaseToken(request), request));
  });
}
