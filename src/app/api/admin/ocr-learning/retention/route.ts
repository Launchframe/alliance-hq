import { NextResponse } from "next/server";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { expireMediaObjects } from "@/lib/ocr/learning/media-retention.server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return withOcrAdmin(async (actor) => {
    const body = await readOcrJson(request);
    return NextResponse.json(await expireMediaObjects(ocrScope(request), body.confirmed === true, actor, body.limit == null ? 20 : Number(body.limit)));
  });
}
