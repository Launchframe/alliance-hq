import { after, NextResponse } from "next/server";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { enqueueMediaTask } from "@/lib/ocr/learning/media-queue.server";
import { verifyMediaUploadSize } from "@/lib/ocr/learning/media-upload.server";
import { dispatchMediaTask } from "@/lib/ocr/learning/media-dispatch.server";

export const maxDuration = 300;
type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  return withOcrAdmin(async (actor) => {
    const { taskId } = await context.params;
    const allianceId = ocrScope(request);
    await readOcrJson(request);
    await verifyMediaUploadSize(allianceId, taskId);
    const task = await enqueueMediaTask(allianceId, taskId, actor);
    if (task.state !== "ready") after(async () => {
      try { await dispatchMediaTask(taskId); }
      catch { console.warn("[ocr-media] dispatch_deferred", { taskId }); }
    });
    return NextResponse.json(task, { status: task.state === "ready" ? 200 : 202 });
  });
}
