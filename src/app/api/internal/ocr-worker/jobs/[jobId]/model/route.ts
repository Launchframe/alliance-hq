import { NextResponse } from "next/server";
import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { workerModelAsset } from "@/lib/ocr/learning/control-read.server";

type Context = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { jobId } = await context.params;
    const model = await workerModelAsset(jobId, workerLeaseToken(request));
    return NextResponse.json({ model: model ? { sha256: model.sha256, bytes: model.bytes, manifestHash: model.manifestHash } : null });
  });
}
