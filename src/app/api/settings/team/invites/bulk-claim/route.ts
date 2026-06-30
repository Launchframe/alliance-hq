import { NextResponse } from "next/server";
import { z } from "zod";

import {
  collectDatabaseErrorText,
  isMissingSchemaError,
} from "@/lib/db/error-message";
import {
  AllianceServerRequiredError,
  createHqClaimInvitesBulk,
} from "@/lib/native-alliance/invites";
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

  const origin = new URL(request.url).origin;

  try {
    const result = await createHqClaimInvitesBulk({
      allianceId: access.allianceId,
      targetAshedMemberIds: body.targetAshedMemberIds,
      invitedByHqUserId: access.ctx.hqUserId,
      origin,
      adminLabel: body.adminLabel,
    });

    return NextResponse.json({
      ok: true,
      created: result.created,
      skipped: result.skipped,
    });
  } catch (error) {
    if (error instanceof AllianceServerRequiredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 },
      );
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
