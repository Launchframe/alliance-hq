import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireActiveShareCapability,
  resolveAshedConnectionForAlliance,
} from "@/lib/ashed/credential-share.server";
import {
  resolveHqAllianceId,
  syncAllianceMembersFromAshed,
} from "@/lib/members/roster.server";
import {
  assertOfficerAshedSessionForSync,
  resolveOfficerAshedAllianceId,
  resolveRosterSyncCapability,
} from "@/lib/members/roster-sync-capability.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { getAllianceById } from "@/lib/vr/repository";
import { resolveAllianceAshedBotConnection } from "@/lib/vr/member-roster";

const bodySchema = z.object({
  confirmMassFormer: z.boolean().optional().default(false),
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
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", code: "INVALID" },
      { status: 400 },
    );
  }

  const capability = await resolveRosterSyncCapability(sessionId, allianceId);
  if (
    capability.kind !== "officer_ashed" &&
    capability.kind !== "alliance_ashed"
  ) {
    return NextResponse.json(
      {
        error:
          "Ashed roster catch-up is not available. Pin a LastRank id and run the LastRank sync CLI, or connect Ashed.",
        code: "UNAVAILABLE",
        capability: capability.kind,
      },
      { status: 400 },
    );
  }

  const massFormerMode = parsed.data.confirmMassFormer
    ? "confirm"
    : "require_confirm";

  try {
    let synced = 0;
    let massFormerPending:
      | { wouldFormerCount: number; confirmedActiveCount: number }
      | undefined;

    if (capability.kind === "alliance_ashed") {
      const alliance = await getAllianceById(allianceId);
      if (!alliance?.ashedAllianceId) {
        return NextResponse.json(
          { error: "Alliance is not linked to Ashed.", code: "UNAVAILABLE" },
          { status: 400 },
        );
      }
      const connection = await resolveAllianceAshedBotConnection(allianceId);
      if (!connection) {
        return NextResponse.json(
          { error: "Alliance bot credentials are missing.", code: "UNAVAILABLE" },
          { status: 400 },
        );
      }
      const result = await syncAllianceMembersFromAshed({
        hqAllianceId: allianceId,
        ashedAllianceId: alliance.ashedAllianceId,
        connection,
        massFormerMode,
      });
      synced = result.synced;
      massFormerPending = result.massFormerPending;
    } else {
      const resolved = await resolveAshedConnectionForAlliance(
        sessionId,
        allianceId,
      );
      if (resolved?.isDelegated) {
        await requireActiveShareCapability({
          sessionId,
          allianceId,
          capability: "roster:sync",
          delegatedAction: "roster.sync",
        });
      }
      const connection = await assertOfficerAshedSessionForSync(
        sessionId,
        allianceId,
      );
      const alliance = await getAllianceById(allianceId);
      const ashedAllianceId =
        alliance?.ashedAllianceId?.trim() ||
        (await resolveOfficerAshedAllianceId(sessionId)).ashedAllianceId;
      const hqAllianceId = await resolveHqAllianceId(
        allianceId,
        ashedAllianceId,
      );
      const result = await syncAllianceMembersFromAshed({
        hqAllianceId,
        ashedAllianceId,
        connection,
        massFormerMode,
      });
      synced = result.synced;
      massFormerPending = result.massFormerPending;
    }

    if (massFormerPending) {
      return NextResponse.json(
        {
          ok: false,
          code: "MASS_FORMER_CONFIRM_REQUIRED",
          error:
            "This roster refresh would mark many members as former. Confirm to continue.",
          massFormerPending,
          synced,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      synced,
      capability: capability.kind,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Roster catch-up failed.",
        code: "FAILED",
      },
      { status: 400 },
    );
  }
}
