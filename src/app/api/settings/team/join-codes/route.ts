import { NextResponse } from "next/server";
import { z } from "zod";

import { createAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import {
  buildMultiUseJoinCodeSharePayload,
  loadAllianceInviteShareContext,
} from "@/lib/native-alliance/invite-share-payload.server";
import {
  assertInviteRoleAllowed,
  isSystemRoleName,
  resolveTeamInviteAccess,
} from "@/lib/native-alliance/team-invites.server";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { readSessionId } from "@/lib/session";

const bodySchema = z.object({
  roleName: z.enum(["officer", "data_entry", "viewer", "member"]).default("member"),
  maxRedemptions: z.number().int().min(1).max(500).default(10),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  adminLabel: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await resolveTeamInviteAccess(sessionId);
  if (access instanceof NextResponse) {
    return access;
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isSystemRoleName(body.roleName)) {
    return NextResponse.json({ error: "Invalid join code role." }, { status: 400 });
  }

  try {
    assertInviteRoleAllowed(access.ctx, body.roleName as SystemRoleName);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Forbidden" },
      { status: 403 },
    );
  }

  try {
    const joinCode = await createAllianceJoinCode({
      allianceId: access.allianceId,
      roleName: body.roleName as SystemRoleName,
      maxRedemptions: body.maxRedemptions,
      expiresInDays: body.expiresInDays,
      adminLabel: body.adminLabel,
      createdByHqUserId: access.ctx.hqUserId,
    });

    const origin = new URL(request.url).origin;
    const alliance = await loadAllianceInviteShareContext(access.allianceId);
    const share = buildMultiUseJoinCodeSharePayload({
      origin,
      allianceName: alliance.allianceName,
      allianceTag: alliance.allianceTag,
      code: joinCode.code,
    });

    return NextResponse.json({
      ok: true,
      joinCode: {
        ...joinCode,
        welcomeUrl: share.welcomeUrl,
        shareMessage: share.shareMessage,
      },
    });
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
