import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { vsErrorResponse } from "@/lib/vs-performance/api-helpers.server";
import {
  getVsVideoImage,
  resolveVsVideoAccess,
} from "@/lib/vs-performance/video-evidence.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const access = await resolveVsVideoAccess(session.id, jobId, "read");
    const versionParam = new URL(request.url).searchParams.get("imageVersion");
    const expectedImageVersion =
      versionParam == null || versionParam === ""
        ? undefined
        : Number(versionParam);
    if (expectedImageVersion != null && !Number.isSafeInteger(expectedImageVersion)) {
      throw new VsPerformanceError("invalid", 400);
    }
    const image = await getVsVideoImage(access, expectedImageVersion);
    const { renderVsVideoEvidencePreview } = await import(
      "@/lib/vs-performance/video-evidence-preview.server"
    );
    const png = await renderVsVideoEvidencePreview(image.stream, image.kind);
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return vsErrorResponse(error);
  }
}
