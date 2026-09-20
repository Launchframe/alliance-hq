import { NextResponse } from "next/server";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { loadWorkerPolicy, saveWorkerPolicy } from "@/lib/ocr/learning/control-policy.server";
import type { WorkerPolicy } from "@/lib/ocr/learning/control.shared";

export async function GET(request: Request) {
  return withOcrAdmin(async () => NextResponse.json(await loadWorkerPolicy(ocrScope(request))));
}

export async function PATCH(request: Request) {
  return withOcrAdmin(async (actor) => {
    const body = await readOcrJson(request);
    return NextResponse.json(await saveWorkerPolicy(ocrScope(request), body.expectedRevision as number, body.policy as WorkerPolicy, actor));
  });
}
