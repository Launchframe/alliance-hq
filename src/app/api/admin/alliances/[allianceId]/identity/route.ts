import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AllianceRenameError,
  renameAllianceInPlace,
} from "@/lib/alliance/rename-in-place.server";
import { getRbacContext } from "@/lib/rbac/context";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { resolveRosterSyncCapability } from "@/lib/members/roster-sync-capability.server";
import { readSessionId } from "@/lib/session";

const bodySchema = z.object({
  tag: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  lastrankAllianceId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{32}$/)
    .optional()
    .nullable(),
});

export async function PATCH(
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
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", code: "INVALID" },
      { status: 400 },
    );
  }

  try {
    const ctx = await getRbacContext(sessionId);
    const result = await renameAllianceInPlace({
      allianceId,
      tag: parsed.data.tag,
      name: parsed.data.name,
      lastrankAllianceId: parsed.data.lastrankAllianceId,
      sessionId,
      hqUserId: ctx?.hqUserId ?? null,
    });

    const capability = await resolveRosterSyncCapability(sessionId, allianceId);

    return NextResponse.json({
      ok: true,
      alliance: result,
      rosterCatchUp: {
        capability: capability.kind,
        ashedAvailable:
          capability.kind === "officer_ashed" ||
          capability.kind === "alliance_ashed",
        lastRankPinned: Boolean(result.lastrankAllianceId),
        lastRankRegistryTag: result.lastRankRegistryTag,
      },
    });
  } catch (error) {
    if (error instanceof AllianceRenameError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONFLICT"
            ? 409
            : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    throw error;
  }
}
