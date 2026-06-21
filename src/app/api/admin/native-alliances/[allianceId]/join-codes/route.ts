import { NextResponse } from "next/server";
import { z } from "zod";

import { createAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import { getRbacContext } from "@/lib/rbac/context";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

const bodySchema = z.object({
  roleName: z
    .enum(["owner", "officer", "data_entry", "viewer", "member"])
    .default("officer"),
  maxRedemptions: z.number().int().min(1).max(500).default(10),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  adminLabel: z.string().trim().max(120).optional(),
  code: z.string().trim().max(64).optional(),
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

  try {
    const ctx = await getRbacContext(sessionId);
    const joinCode = await createAllianceJoinCode({
      allianceId,
      roleName: body.roleName as SystemRoleName,
      maxRedemptions: body.maxRedemptions,
      expiresInDays: body.expiresInDays,
      adminLabel: body.adminLabel,
      code: body.code,
      createdByHqUserId: ctx?.hqUserId ?? null,
    });

    return NextResponse.json({ ok: true, joinCode });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not create join code.",
      },
      { status: 400 },
    );
  }
}
