import { NextResponse } from "next/server";
import { ocrScope, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { receiveLocalMedia } from "@/lib/ocr/learning/media-upload.server";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ taskId: string }> };

export async function PUT(request: Request, context: Context) {
  return withOcrAdmin(async (actor) => {
    const { taskId } = await context.params;
    return NextResponse.json(await receiveLocalMedia(ocrScope(request), taskId, actor, request));
  });
}
