import { NextResponse } from "next/server";
import { z } from "zod";

import { getRbacContext } from "@/lib/rbac/context";
import { requireApiSession } from "@/lib/session";
import {
  canEditScoreboardReviewPreferences,
  loadScoreboardReviewPreferences,
  updateScoreboardReviewPreferences,
} from "@/lib/video/scoreboard-review-preferences.server";
import { DEFAULT_SCOREBOARD_REVIEW_PREFERENCES } from "@/lib/video/scoreboard-review-preferences.shared";

const patchSchema = z
  .object({
    offerCreate: z.boolean().optional(),
    offerRename: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.offerCreate !== undefined || body.offerRename !== undefined,
    { message: "At least one preference field is required." },
  );

export async function GET() {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const rbac = await getRbacContext(session.id);
    const canEdit = canEditScoreboardReviewPreferences({
      roleName: rbac?.roleName,
      isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
    });
    if (!canEdit || !rbac?.hqUserId) {
      return NextResponse.json({
        ...DEFAULT_SCOREBOARD_REVIEW_PREFERENCES,
        canEdit: false,
      });
    }

    const preferences = await loadScoreboardReviewPreferences(rbac.hqUserId);
    return NextResponse.json({ ...preferences, canEdit: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load scoreboard preferences",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = patchSchema.parse(await request.json());
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const rbac = await getRbacContext(session.id);
    if (
      !rbac?.hqUserId ||
      !canEditScoreboardReviewPreferences({
        roleName: rbac.roleName,
        isPlatformMaintainer: rbac.isPlatformMaintainer,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const preferences = await updateScoreboardReviewPreferences(rbac.hqUserId, {
      ...(body.offerCreate !== undefined
        ? { offerCreate: body.offerCreate }
        : {}),
      ...(body.offerRename !== undefined
        ? { offerRename: body.offerRename }
        : {}),
    });

    return NextResponse.json({ ok: true, ...preferences, canEdit: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid scoreboard preferences payload." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save scoreboard preferences",
      },
      { status: 500 },
    );
  }
}
