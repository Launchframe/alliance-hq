import { NextResponse } from "next/server";
import { z } from "zod";

import { getRbacContext } from "@/lib/rbac/context";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { fulfillOpenSetupRequestForTag } from "@/lib/alliance/alliance-setup-request.server";
import { createNativeAlliance } from "@/lib/native-alliance/provision";
import { readSessionId } from "@/lib/session";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  tag: z.string().trim().min(1).max(32),
  gameServerNumber: z.number().int().positive().max(9999),
  ownerEmail: z.string().trim().email().optional(),
  ownerRole: z
    .enum(["owner", "officer", "data_entry", "viewer", "member"])
    .optional(),
}).refine(
  (data) => !(data.ownerEmail && data.ownerRole === "member"),
  { message: "ownerRole 'member' cannot be combined with ownerEmail — a named owner must have owner-level access." },
);

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Invalid request body.")
        : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const ctx = await getRbacContext(sessionId);
    const result = await createNativeAlliance({
      name: body.name,
      tag: body.tag,
      gameServerNumber: body.gameServerNumber,
      ownerEmail: body.ownerEmail,
      ownerRole: (body.ownerRole ?? "owner") as SystemRoleName,
      invitedByHqUserId: ctx?.hqUserId ?? null,
    });

    if (ctx?.hqUserId) {
      await fulfillOpenSetupRequestForTag({
        tag: result.tag,
        allianceId: result.allianceId,
        fulfilledByHqUserId: ctx.hqUserId,
      });
    }

    return NextResponse.json({ ok: true, alliance: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Create failed." },
      { status: 400 },
    );
  }
}
