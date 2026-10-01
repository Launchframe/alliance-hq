import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { vsErrorResponse } from "@/lib/vs-performance/api-helpers.server";
import {
  resolveVsVideoAccess,
  uploadLocalVsVideoImage,
} from "@/lib/vs-performance/video-evidence.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ jobId: string }> };

export async function PUT(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const imageVersion = Number(
      new URL(request.url).searchParams.get("imageVersion"),
    );
    if (!Number.isSafeInteger(imageVersion) || imageVersion <= 0) {
      throw new VsPerformanceError("invalid", 400);
    }
    if (!request.body) throw new VsPerformanceError("invalid", 400);
    const access = await resolveVsVideoAccess(session.id, jobId, "upload");
    await uploadLocalVsVideoImage(access, imageVersion, request.body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return vsErrorResponse(error);
  }
}
