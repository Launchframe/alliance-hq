import { NextResponse } from "next/server";
import { z } from "zod";

import {
  collectDatabaseErrorText,
  isMissingSchemaError,
} from "@/lib/db/error-message";
import {
  CommanderClaimInviteError,
} from "@/lib/native-alliance/invites";
import { createAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import {
  buildClaimCodeSharePayload,
  loadAllianceInviteShareContext,
} from "@/lib/native-alliance/invite-share-payload.server";
import {
  assertInviteRoleAllowed,
  resolveTeamInviteAccess,
} from "@/lib/native-alliance/team-invites.server";
import { MAX_BULK_CLAIM_INVITES } from "@/lib/native-alliance/claim-invites.shared";
import { readSessionId } from "@/lib/session";

const bodySchema = z.object({
  targetAshedMemberIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(MAX_BULK_CLAIM_INVITES),
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

  try {
    assertInviteRoleAllowed(access.ctx, "member");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Forbidden" },
      { status: 403 },
    );
  }

  const created: Array<{
    targetAshedMemberId: string;
    targetCommanderName: string | null;
    code: string;
    welcomeUrl: string;
    shareMessage: string;
  }> = [];
  const skipped: Array<{ ashedMemberId: string; code: string }> = [];
  const seen = new Set<string>();
  const origin = new URL(request.url).origin;
  const alliance = await loadAllianceInviteShareContext(access.allianceId);

  for (const rawId of body.targetAshedMemberIds) {
    const ashedMemberId = rawId.trim();
    if (!ashedMemberId || seen.has(ashedMemberId)) continue;
    seen.add(ashedMemberId);

    try {
      const joinCode = await createAllianceJoinCode({
        allianceId: access.allianceId,
        roleName: "member",
        maxRedemptions: 1,
        adminLabel: body.adminLabel,
        createdByHqUserId: access.ctx.hqUserId,
        targetAshedMemberId: ashedMemberId,
      });
      created.push({
        targetAshedMemberId: ashedMemberId,
        targetCommanderName: joinCode.targetCommanderName,
        code: joinCode.code,
        ...buildClaimCodeSharePayload({
          origin,
          allianceName: alliance.allianceName,
          allianceTag: alliance.allianceTag,
          code: joinCode.code,
        }),
      });
    } catch (error) {
      if (error instanceof CommanderClaimInviteError) {
        skipped.push({ ashedMemberId, code: error.code });
        continue;
      }
      if (isMissingSchemaError(error)) {
        return NextResponse.json(
          {
            error:
              "Invite storage schema is out of date. Contact a platform maintainer.",
          },
          { status: 503 },
        );
      }
      const detail = collectDatabaseErrorText(error);
      return NextResponse.json(
        {
          error:
            error instanceof Error && !detail.includes("Failed query")
              ? error.message
              : "Bulk claim invites failed.",
          ...(process.env.NODE_ENV === "development" ? { detail } : {}),
        },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ ok: true, created, skipped });
}
