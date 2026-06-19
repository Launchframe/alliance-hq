import { NextResponse } from "next/server";
import { z } from "zod";

import { getRbacContext } from "@/lib/rbac/context";
import { createHqInvite } from "@/lib/native-alliance/invites";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().trim().email(),
  roleName: z.enum(["owner", "officer", "data_entry", "viewer"]).default("officer"),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ allianceId: string }> },
) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { allianceId } = await context.params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  try {
    const ctx = await getRbacContext(sessionId);
    const invite = await createHqInvite({
      allianceId,
      email: body.email,
      roleName: body.roleName as SystemRoleName,
      invitedByHqUserId: ctx?.hqUserId ?? null,
      origin,
    });

    return NextResponse.json({ ok: true, invite });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invite failed." },
      { status: 400 },
    );
  }
}
