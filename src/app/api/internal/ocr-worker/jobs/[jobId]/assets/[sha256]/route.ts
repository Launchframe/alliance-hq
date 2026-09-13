import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { workerAssetResponse, workerFrameAsset } from "@/lib/ocr/learning/control-read.server";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ jobId: string; sha256: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { jobId, sha256 } = await context.params;
    return workerAssetResponse(await workerFrameAsset(jobId, workerLeaseToken(request), sha256));
  });
}
