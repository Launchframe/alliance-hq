import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ocrScope, readOcrJson, withOcrAdmin } from "@/lib/ocr/learning/api.server";
import { createMediaUpload } from "@/lib/ocr/learning/media-queue.server";
import { mediaUploadTarget } from "@/lib/ocr/learning/media-upload.server";
import type { OcrMediaUpload } from "@/lib/ocr/learning/media.shared";

export async function GET(request: Request) {
  return withOcrAdmin(async () => {
    const tasks = await getDb().select({ id: schema.ocrMediaTasks.id, fileName: schema.ocrMediaTasks.fileName, scoreTarget: schema.ocrMediaTasks.scoreTarget, state: schema.ocrMediaTasks.state, expectedBytes: schema.ocrMediaTasks.expectedBytes, errorCode: schema.ocrMediaTasks.errorCode, expiresAt: schema.ocrMediaTasks.expiresAt, createdAt: schema.ocrMediaTasks.createdAt }).from(schema.ocrMediaTasks).where(eq(schema.ocrMediaTasks.allianceId, ocrScope(request))).orderBy(desc(schema.ocrMediaTasks.createdAt)).limit(200);
    return NextResponse.json({ tasks });
  });
}

export async function POST(request: Request) {
  return withOcrAdmin(async (actor) => {
    const task = await createMediaUpload(await readOcrJson(request) as OcrMediaUpload, actor);
    const result = task.state === "uploading" ? await mediaUploadTarget(task.allianceId, task.id, actor) : { id: task.id };
    return NextResponse.json({ ...result, state: task.state }, { status: 201 });
  });
}
