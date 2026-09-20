import { NextResponse } from "next/server";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { loadMediaTask } from "@/lib/ocr/learning/media-queue.server";

type Context = { params: Promise<{ taskId: string }> };

export async function GET(request: Request, context: Context) {
  return withOcrAdmin(async () => {
    const { taskId } = await context.params;
    const task = await loadMediaTask(ocrScope(request), taskId);
    return NextResponse.json({ id: task.id, state: task.state, fileName: task.fileName, scoreTarget: task.scoreTarget, expectedBytes: task.expectedBytes, sourceSha256: task.expectedSha256, errorCode: task.errorCode, expiresAt: task.expiresAt, attempts: task.attempts, caseId: task.state === "ready" ? task.id : null });
  });
}
