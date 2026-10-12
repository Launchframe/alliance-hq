import { NextResponse } from "next/server";

import { commanderTransferRequestSchema } from "@/lib/admin/commander-transfer.shared";
import {
  listCommanderTransferCandidates,
  previewCommanderTransfer,
  transferCommander,
} from "@/lib/admin/commander-transfer.server";
import { getRbacContext, requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const allianceId = new URL(request.url).searchParams.get("allianceId")?.trim();
  if (!allianceId) {
    return NextResponse.json({ error: "allianceId is required" }, { status: 400 });
  }
  const members = await listCommanderTransferCandidates(allianceId);
  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const rbac = await getRbacContext(sessionId);
  if (!rbac?.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = commanderTransferRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { dryRun, ...input } = parsed.data;

  const result = dryRun
    ? await previewCommanderTransfer(input)
    : await transferCommander({
        ...input,
        actorHqUserId: rbac.hqUserId,
        sessionId,
      });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 409 });
  }
  return NextResponse.json({ summary: result.summary, dryRun: Boolean(dryRun) });
}
