import { NextResponse } from "next/server";
import { z } from "zod";

import {
  collectDatabaseErrorText,
  isMissingSchemaError,
} from "@/lib/db/error-message";
import { createHqInvite, type HqInviteKind } from "@/lib/native-alliance/invites";
import { getRbacContext } from "@/lib/rbac/context";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

const bodySchema = z
  .object({
    kind: z.enum(["email", "protected_link"]).default("email"),
    email: z.string().trim().email().optional(),
    roleName: z
      .enum(["owner", "officer", "data_entry", "viewer", "member"])
      .default("officer"),
    redirectPath: z.string().trim().max(512).optional(),
    adminLabel: z.string().trim().max(120).optional(),
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
      kind: body.kind as HqInviteKind,
      email: body.email,
      roleName: body.roleName as SystemRoleName,
      invitedByHqUserId: ctx?.hqUserId ?? null,
      origin,
      redirectPath: sanitizeInternalRedirectPath(body.redirectPath),
      adminLabel: body.adminLabel,
    });

    return NextResponse.json({ ok: true, invite });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json(
        {
          error:
            "Invite storage schema is out of date. Redeploy or run db:prepare to apply pending migrations.",
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
