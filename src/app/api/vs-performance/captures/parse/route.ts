import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_SCREENSHOT_UPLOAD_BYTES } from "@/lib/ocr/screenshot-upload.shared";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { stageVsCaptureReview } from "@/lib/vs-performance/vs-capture.server";
import { vsWeekStartSchema } from "@/lib/vs-performance/weekly-plan.shared";
import { assertVsScope } from "@/lib/vs-performance/vs-scope.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const fieldsSchema = z
  .object({
    kind: z.enum(["weekly_overview", "daily_totals"]),
    weekStart: vsWeekStartSchema,
    scope: z.string().min(1).max(200),
  })
  .strict();

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }
  let fields: z.infer<typeof fieldsSchema>;
  try {
    fields = fieldsSchema.parse({
      kind: formData.get("kind"),
      weekStart: formData.get("weekStart"),
      scope: formData.get("scope"),
    });
  } catch (error) {
    return vsErrorResponse(error);
  }
  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }
  if (image.size > MAX_SCREENSHOT_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 413 },
    );
  }
  if (image.type && image.type !== "image/png" && image.type !== "image/jpeg") {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }
  try {
    assertVsScope(actor, fields.weekStart, fields.scope);
    const buffer = Buffer.from(await image.arrayBuffer());
    const { parseVsCaptureImage } = await import("@/lib/vs-performance/vs-capture-ocr.server");
    const candidate = await parseVsCaptureImage(buffer, fields.kind);
    const result = await stageVsCaptureReview({
      actor,
      kind: fields.kind,
      weekStart: fields.weekStart,
      scope: fields.scope,
      image: buffer,
      candidate,
    });
    return NextResponse.json(result);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
