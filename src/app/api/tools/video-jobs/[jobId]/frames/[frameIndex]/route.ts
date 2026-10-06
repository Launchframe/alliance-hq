import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { readSessionId } from "@/lib/session";
import { getObject } from "@/lib/storage";
import { isWarzoneEvidenceTarget } from "@/lib/video/warzone-evidence.shared";
import {
  isAllianceVideoJobOpsDenied,
  loadAllianceScopedVideoJob,
  requireAllianceVideoJobOps,
} from "@/lib/video/alliance-video-jobs-access.server";

type RouteParams = {
  params: Promise<{ jobId: string; frameIndex: string }>;
};

/** `?crop=left,top,width,height` in relative [0,1] coords. */
function parseCropParam(raw: string | null) {
  if (!raw) return null;
  const parts = raw.split(",").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [left, top, width, height] = parts;
  if (
    left < 0 ||
    top < 0 ||
    width <= 0 ||
    height <= 0 ||
    left + width > 1 ||
    top + height > 1
  ) {
    return null;
  }
  return { left, top, width, height };
}

export async function GET(request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  const ops = await requireAllianceVideoJobOps(sessionId);
  if (isAllianceVideoJobOpsDenied(ops)) return ops;

  const { jobId, frameIndex: frameIndexParam } = await params;
  const access = await loadAllianceScopedVideoJob(jobId, ops.allianceId);
  if (!access.ok) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const frameIndex = Number(frameIndexParam);
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    return NextResponse.json({ error: "Invalid frame index" }, { status: 400 });
  }

  const db = getDb();
  const [frame] = await db
    .select()
    .from(schema.videoFrames)
    .where(
      and(
        eq(schema.videoFrames.jobId, jobId),
        eq(schema.videoFrames.frameIndex, frameIndex),
      ),
    )
    .limit(1);

  if (!frame) {
    return NextResponse.json({ error: "Frame not found" }, { status: 404 });
  }

  const buffer = await getObject(frame.storageKey);

  const crop = parseCropParam(
    new URL(request.url).searchParams.get("crop"),
  );
  const isEventEvidenceJob = isWarzoneEvidenceTarget(
    access.job.scoreTarget ?? access.job.category,
  );
  if (isEventEvidenceJob) {
    // Event frames can contain chat/announcements/UIDs outside the evidence
    // region — reviewers only ever get the cropped foreground region, never
    // the original bytes.
    if (!crop) {
      return NextResponse.json({ error: "Frame not found" }, { status: 404 });
    }
    const sharp = (await import("sharp")).default;
    const image = sharp(buffer).rotate();
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= 0 || height <= 0) {
      return NextResponse.json({ error: "Frame not found" }, { status: 404 });
    }
    const cropped = await image
      .extract({
        left: Math.floor(crop.left * width),
        top: Math.floor(crop.top * height),
        width: Math.max(1, Math.round(crop.width * width)),
        height: Math.max(1, Math.round(crop.height * height)),
      })
      .png()
      .toBuffer();
    return new Response(new Uint8Array(cropped), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
