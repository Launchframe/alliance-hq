import { NextResponse } from "next/server";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { loadMediaPolicy, saveMediaPolicy } from "@/lib/ocr/learning/media-queue.server";
import type { OcrMediaPolicy } from "@/lib/ocr/learning/media.shared";

export async function GET(request: Request) {
  return withOcrAdmin(async () => NextResponse.json(await loadMediaPolicy(ocrScope(request))));
}

export async function PATCH(request: Request) {
  return withOcrAdmin(async (actor) => {
    const body = await readOcrJson(request);
    return NextResponse.json(await saveMediaPolicy(ocrScope(request), body.expectedRevision as number, body.policy as OcrMediaPolicy, actor));
  });
}
