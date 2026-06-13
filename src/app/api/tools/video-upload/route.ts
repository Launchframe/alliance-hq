import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    const formData = await request.formData();
    const file = formData.get("video");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No video file provided." },
        { status: 400 },
      );
    }

    const category = String(formData.get("category") ?? "general");
    const maxBytes = 200 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "Video must be under 200 MB for now." },
        { status: 400 },
      );
    }

    const jobId = nanoid(16);
    const db = getDb();
    const now = new Date();

    await db.insert(schema.videoJobs).values({
      id: jobId,
      sessionId: session.id,
      status: "queued",
      fileName: file.name,
      fileSizeBytes: file.size,
      category,
      frameCount: null,
      uploadedFrameCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // TODO: push to object storage + ffmpeg worker (Inngest/Railway)
    // For now the job is recorded; processing will be wired when worker lands.

    return NextResponse.json({
      ok: true,
      jobId,
      status: "queued",
      message:
        "Video received. Frame extraction and Ashed upload will run when the worker is connected.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const session = await getOrCreateSession();
    const db = getDb();
    const jobs = await db
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.sessionId, session.id))
      .orderBy(desc(schema.videoJobs.createdAt));

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        fileName: job.fileName,
        fileSizeBytes: job.fileSizeBytes,
        category: job.category,
        frameCount: job.frameCount,
        uploadedFrameCount: job.uploadedFrameCount,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list jobs",
      },
      { status: 500 },
    );
  }
}
