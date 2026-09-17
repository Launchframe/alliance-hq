import "server-only";

import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { getRbacContext, requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { postgresErrorCode } from "@/lib/db/error-message";
import { OcrLearningError, ocrIdSchema } from "../benchmark/types.shared";
import type { OcrActor } from "./corpus.server";

export async function withOcrAdmin(action: (actor: OcrActor) => Promise<Response>): Promise<Response> {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const denied = await requirePlatformMaintainer(session.id);
    if (denied) return denied;
    const context = await getRbacContext(session.id);
    if (!context?.hqUserId) throw new OcrLearningError("forbidden", 403);
    const response = await action({ hqUserId: context.hqUserId, sessionId: session.id });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (!(error instanceof OcrLearningError)) console.error("[ocr-learning] operation_failed", { code: postgresErrorCode(error) });
    return NextResponse.json({ ok: false, code: error instanceof OcrLearningError ? error.code : "internal_error" }, { status: error instanceof OcrLearningError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

export function ocrScope(request: Request): string {
  const parsed = ocrIdSchema.safeParse(new URL(request.url).searchParams.get("allianceId"));
  if (!parsed.success) throw new OcrLearningError("invalid_scope");
  return parsed.data;
}

export async function readOcrJson(request: Request, limit = 2 * 1024 * 1024): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 8 * 1024 * 1024) throw new OcrLearningError("invalid_input_limit");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new OcrLearningError("json_required", 415);
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new OcrLearningError("input_limit", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new OcrLearningError("invalid_request");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new OcrLearningError("input_limit", 413); }
      chunks.push(next.value);
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new OcrLearningError("invalid_request");
    return value;
  } catch (error) {
    if (error instanceof OcrLearningError) throw error;
    throw new OcrLearningError("invalid_request");
  } finally { reader.releaseLock(); }
}
