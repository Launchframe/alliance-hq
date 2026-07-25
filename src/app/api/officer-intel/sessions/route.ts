/**
 * GET/POST /api/officer-intel/sessions
 */

import { NextResponse } from "next/server";

import { loadOfficerIntelDashboard } from "@/lib/officer-intel/load-dashboard.server";
import { createOfficerChatSession } from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelRead,
  requireOfficerIntelWrite,
} from "@/lib/officer-intel/route-helpers.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelRead(context.sessionId);
  if (denied) return denied;

  const dashboard = await loadOfficerIntelDashboard(
    context.sessionId,
    context.allianceId,
  );
  if (!dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(dashboard);
}

type CreateSessionBody = {
  title?: unknown;
  channelLabel?: unknown;
  sessionAt?: unknown;
};

export async function POST(request: Request) {
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelWrite(context.sessionId);
  if (denied) return denied;

  let body: CreateSessionBody;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("body must be an object");
    }
    body = parsed as CreateSessionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title =
    typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim()
      : "Officer chat session";
  const channelLabel =
    typeof body.channelLabel === "string" ? body.channelLabel.trim() : null;
  const sessionAt =
    typeof body.sessionAt === "string" && body.sessionAt.trim().length > 0
      ? new Date(body.sessionAt)
      : null;
  if (sessionAt && Number.isNaN(sessionAt.getTime())) {
    return NextResponse.json({ error: "Invalid sessionAt." }, { status: 400 });
  }

  const sessionId = await createOfficerChatSession({
    allianceId: context.allianceId,
    title,
    channelLabel,
    sessionAt,
    createdByHqUserId: context.session.hqUserId,
  });

  return NextResponse.json({ sessionId });
}
