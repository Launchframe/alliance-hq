import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { vsErrorResponse } from "@/lib/vs-performance/api-helpers.server";
import {
  completeVsVideoImageUpload,
  resolveVsVideoAccess,
} from "@/lib/vs-performance/video-evidence.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const body = await request.json();
    const access = await resolveVsVideoAccess(session.id, jobId, "upload");
    return NextResponse.json(await completeVsVideoImageUpload(access, body));
  } catch (error) {
    return vsErrorResponse(error);
  }
}
