import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { vsErrorResponse } from "@/lib/vs-performance/api-helpers.server";
import {
  resolveVsVideoAccess,
} from "@/lib/vs-performance/video-evidence.server";
import { saveVsVideoMatchOnly } from "@/lib/vs-performance/video-evidence-submit.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Props = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const access = await resolveVsVideoAccess(session.id, jobId, "review");
    const body = await request.json();
    return NextResponse.json(await saveVsVideoMatchOnly(access, body));
  } catch (error) {
    return vsErrorResponse(error);
  }
}
