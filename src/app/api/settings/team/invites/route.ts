import { NextResponse } from "next/server";
import { z } from "zod";

import {
  collectDatabaseErrorText,
  isMissingSchemaError,
} from "@/lib/db/error-message";
import {
  AllianceServerRequiredError,
  CommanderClaimInviteError,
  createHqInvite,
  type HqInviteKind,
} from "@/lib/native-alliance/invites";
import {
  assertInviteRoleAllowed,
  isSystemRoleName,
  resolveTeamInviteAccess,
} from "@/lib/native-alliance/team-invites.server";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { readSessionId } from "@/lib/session";

const bodySchema = z
  .object({
    kind: z.enum(["email", "protected_link"]).default("protected_link"),
    email: z.string().trim().email().optional(),
    roleName: z.enum(["officer", "data_entry", "viewer", "member"]),
    redirectPath: z.string().trim().max(512).optional(),
    adminLabel: z.string().trim().max(120).optional(),
    targetAshedMemberId: z.string().trim().min(1).max(64).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "email" && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email is required for email invites.",
        path: ["email"],
      });
    }
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
    return NextResponse.json({ error: "Invalid invite role." }, { status: 400 });
  }

  try {
    assertInviteRoleAllowed(access.ctx, body.roleName as SystemRoleName);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Forbidden" },
      { status: 403 },
    );
  }

  const origin = new URL(request.url).origin;

  try {
    const invite = await createHqInvite({
      allianceId: access.allianceId,
      kind: body.kind as HqInviteKind,
      email: body.email,
      roleName: body.roleName as SystemRoleName,
      invitedByHqUserId: access.ctx.hqUserId,
      origin,
      redirectPath: sanitizeInternalRedirectPath(body.redirectPath),
      adminLabel: body.adminLabel,
      targetAshedMemberId: body.targetAshedMemberId,
    });

    return NextResponse.json({ ok: true, invite });
  } catch (error) {
    if (error instanceof AllianceServerRequiredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 },
      );
    }
    if (error instanceof CommanderClaimInviteError) {
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
            : "Invite failed.",
        ...(process.env.NODE_ENV === "development" ? { detail } : {}),
      },
      { status: 400 },
    );
  }
}
