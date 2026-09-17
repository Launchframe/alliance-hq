import { NextResponse } from "next/server";
import { OcrLearningError } from "@/lib/ocr/benchmark/types.shared";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { revokeModelVersion } from "@/lib/ocr/learning/control-jobs.server";

type Context = { params: Promise<{ modelId: string }> };

export async function DELETE(request: Request, context: Context) {
  return withOcrAdmin(async (actor) => {
    const { modelId } = await context.params;
    const body = await readOcrJson(request);
    if (body.confirmed !== true) throw new OcrLearningError("confirmation_required");
    return NextResponse.json(await revokeModelVersion(ocrScope(request), modelId, actor));
  });
}
