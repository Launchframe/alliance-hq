import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, schema } from "@/lib/db";
import { getObjectRange, getObjectSize } from "@/lib/storage";
import { getOrCreateSession } from "@/lib/session";
import { parseBytesRangeHeader } from "@/lib/video/http-byte-range";
import {
  resolveJobVideoStorageKey,
  videoContentTypeFromFileName,
} from "@/lib/video/resolve-job-video-storage";

type Props = { params: Promise<{ jobId: string }> };

async function resolveOwnedJobVideo(jobId: string, sessionId: string) {
  const db = getDb();
  const [job] = await db
    .select({
      id: schema.videoJobs.id,
      sessionId: schema.videoJobs.sessionId,
      storageKey: schema.videoJobs.storageKey,
      groupId: schema.videoJobs.groupId,
      fileName: schema.videoJobs.fileName,
    })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        eq(schema.videoJobs.sessionId, sessionId),
      ),
    )
    .limit(1);

  if (!job) {
    return { error: NextResponse.json({ error: "Job not found" }, { status: 404 }) };
  }

  const storageKey = await resolveJobVideoStorageKey(job);
  if (!storageKey) {
    return {
      error: NextResponse.json({ error: "Video not available" }, { status: 404 }),
    };
  }

  return {
    storageKey,
    contentType: videoContentTypeFromFileName(job.fileName),
  };
}

async function buildVideoResponse(
  request: Request,
  storageKey: string,
  contentType: string,
  includeBody: boolean,
): Promise<Response> {
  const size = await getObjectSize(storageKey);
  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const parsedRange = parseBytesRangeHeader(request.headers.get("Range"), size);

  if (parsedRange === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  if (parsedRange) {
    const { start, end } = parsedRange;
    const headers = {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    };

    if (!includeBody) {
      return new Response(null, { status: 206, headers });
    }

    const chunk = await getObjectRange(storageKey, start, end);
    return new Response(new Uint8Array(chunk), { status: 206, headers });
  }

  const headers = {
    ...baseHeaders,
    "Content-Length": String(size),
  };

  if (!includeBody) {
    return new Response(null, { status: 200, headers });
  }

  const buffer = await getObjectRange(storageKey, 0, size - 1);
  return new Response(new Uint8Array(buffer), { status: 200, headers });
}

export async function HEAD(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const resolved = await resolveOwnedJobVideo(jobId, session.id);
    if ("error" in resolved) return resolved.error;

    return await buildVideoResponse(
      request,
      resolved.storageKey,
      resolved.contentType,
      false,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load video" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const resolved = await resolveOwnedJobVideo(jobId, session.id);
    if ("error" in resolved) return resolved.error;

    return await buildVideoResponse(
      request,
      resolved.storageKey,
      resolved.contentType,
      true,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load video" },
      { status: 500 },
    );
  }
}
