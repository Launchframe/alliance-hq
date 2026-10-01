import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { vsErrorResponse } from "@/lib/vs-performance/api-helpers.server";
import {
  beginVsVideoImageUpload,
  loadVsVideoEvidence,
  removeVsVideoImage,
  resolveVsVideoAccess,
  updateVsVideoEvidence,
} from "@/lib/vs-performance/video-evidence.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const access = await resolveVsVideoAccess(session.id, jobId, "read");
    return NextResponse.json(await loadVsVideoEvidence(access));
  } catch (error) {
    return vsErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const mode = body && typeof body === "object" && "draft" in body ? "review" : "upload";
    const access = await resolveVsVideoAccess(session.id, jobId, mode);
    return NextResponse.json(await updateVsVideoEvidence(access, body));
  } catch (error) {
    return vsErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const body = await request.json();
    const access = await resolveVsVideoAccess(session.id, jobId, "upload");
    return NextResponse.json(await beginVsVideoImageUpload(access, body));
  } catch (error) {
    return vsErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const body = (await request.json()) as { expectedVersion?: unknown };
    const access = await resolveVsVideoAccess(session.id, jobId, "upload");
    const expectedVersion = body?.expectedVersion;
    if (typeof expectedVersion !== "number") {
      throw new VsPerformanceError("invalid", 400);
    }
    return NextResponse.json(
      await removeVsVideoImage(access, expectedVersion),
    );
  } catch (error) {
    return vsErrorResponse(error);
  }
}
