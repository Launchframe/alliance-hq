import { NextResponse } from "next/server";
import { z } from "zod";

import {
  mergeRosterDuplicates,
  removeRosterDuplicates,
  scanRosterDuplicates,
} from "@/lib/members/roster-duplicate-cleanup.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["merge", "remove"]),
  ashedMemberIds: z.array(z.string().min(1).max(64)).min(1).max(400),
  confirmInexact: z.boolean().optional(),
});

type Props = { params: Promise<{ allianceId: string }> };

export async function GET(_request: Request, { params }: Props) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const denied = await requirePlatformMaintainer(sessionOrError.id);
  if (denied) return denied;

  const { allianceId } = await params;
  const scan = await scanRosterDuplicates(allianceId);
  if (!scan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(scan);
}

export async function POST(request: Request, { params }: Props) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const denied = await requirePlatformMaintainer(sessionOrError.id);
  if (denied) return denied;
  if (!sessionOrError.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { allianceId } = await params;
  if (body.action === "remove") {
    const removed = await removeRosterDuplicates({
      allianceId,
      ashedMemberIds: body.ashedMemberIds,
      actorHqUserId: sessionOrError.hqUserId,
      sessionId: sessionOrError.id,
    });
    if (!removed.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(removed.result);
  }

  const merged = await mergeRosterDuplicates({
    allianceId,
    ashedMemberIds: body.ashedMemberIds,
    confirmInexact: body.confirmInexact === true,
    actorHqUserId: sessionOrError.hqUserId,
    sessionId: sessionOrError.id,
  });
  if (!merged.ok && "code" in merged) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!merged.ok) {
    const status =
      merged.rejection.code === "inexact_confirmation_required" ? 409 : 400;
    return NextResponse.json(merged.rejection, { status });
  }
  return NextResponse.json(merged.result);
}
