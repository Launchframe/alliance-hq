/**
 * POST /api/officer-intel/ask
 */

import { NextResponse } from "next/server";

import { streamOfficerIntelAsk } from "@/lib/officer-intel/ask.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelRead,
} from "@/lib/officer-intel/route-helpers.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelRead(context.sessionId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid body");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }

  const threadId =
    typeof body.threadId === "string"
      ? body.threadId
      : body.threadId === null
        ? null
        : undefined;

  return streamOfficerIntelAsk({
    allianceId: context.allianceId,
    hqUserId: context.session.hqUserId ?? null,
    question,
    threadId,
  });
}
