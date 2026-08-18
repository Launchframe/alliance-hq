/**
 * POST /api/officer-intel/ask
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelRead,
} from "@/lib/officer-intel/route-helpers.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const ASK_SERVER_PATH = join(
  process.cwd(),
  "src/lib/officer-intel/ask.server.ts",
);

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

  if (!existsSync(ASK_SERVER_PATH)) {
    return NextResponse.json(
      { error: "Ask pipe not wired yet." },
      { status: 501 },
    );
  }

  const { streamOfficerIntelAsk } = await import("@/lib/officer-intel/ask.server");
  return streamOfficerIntelAsk({
    allianceId: context.allianceId,
    hqUserId: context.session.hqUserId ?? null,
    sessionId: context.sessionId,
    question,
    threadId,
  });
}
