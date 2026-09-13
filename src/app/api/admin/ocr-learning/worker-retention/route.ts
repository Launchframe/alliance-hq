import { NextResponse } from "next/server";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { expireWorkerArtifacts } from "@/lib/ocr/learning/control-retention.server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return withOcrAdmin(async (actor) => {
    const body = await readOcrJson(request);
    return NextResponse.json(await expireWorkerArtifacts(ocrScope(request), body.confirmed === true, actor, body.limit == null ? 20 : Number(body.limit)));
  });
}
