import { OcrLearningError } from "@/lib/ocr/benchmark/types.shared";
import { withOcrWorker, workerLeaseToken } from "@/lib/ocr/learning/control-api.server";
import { workerAssetResponse, workerModelAsset } from "@/lib/ocr/learning/control-read.server";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrWorker(request, async () => {
    const { jobId } = await context.params;
    const model = await workerModelAsset(jobId, workerLeaseToken(request));
    if (!model) throw new OcrLearningError("model_unavailable", 404);
    return workerAssetResponse(model);
  });
}
