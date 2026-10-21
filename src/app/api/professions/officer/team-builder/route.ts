import { NextResponse } from "next/server";

import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import {
  applyProfessionTeamBuilder,
  loadProfessionTeamBuilderRoster,
} from "@/lib/professions/team-builder.server";
import { ALLIANCE_ADMIN_PERMISSION } from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function officerAlliance() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const denied = await requireSessionPermission(
    sessionOrError.id,
    "alliance:admin",
  );
  if (denied) return denied;
  const allianceId = sessionOrError.currentAllianceId ?? sessionOrError.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }
  return { session: sessionOrError, allianceId };
}

export async function GET() {
  const gate = await officerAlliance();
  if (gate instanceof NextResponse) return gate;
  const members = await loadProfessionTeamBuilderRoster(gate.allianceId);
  return NextResponse.json({ ok: true, members });
}

export async function POST(request: Request) {
  const gate = await officerAlliance();
  if (gate instanceof NextResponse) return gate;

  const body = (await request.json()) as {
    professionFills?: { commanderId?: string; profession?: string }[];
    assignments?: { engCommanderId?: string; wlCommanderId?: string | null }[];
  };

  const professionFills: {
    commanderId: string;
    profession: "Engineer" | "War Leader";
  }[] = [];
  for (const row of body.professionFills ?? []) {
    if (!row.commanderId?.trim()) continue;
    if (row.profession !== "Engineer" && row.profession !== "War Leader") continue;
    professionFills.push({
      commanderId: row.commanderId.trim(),
      profession: row.profession,
    });
  }
  const assignments = (body.assignments ?? []).flatMap((row) => {
    if (!row.engCommanderId?.trim()) return [];
    const wl =
      typeof row.wlCommanderId === "string" && row.wlCommanderId.trim()
        ? row.wlCommanderId.trim()
        : null;
    return [{ engCommanderId: row.engCommanderId.trim(), wlCommanderId: wl }];
  });

  try {
    const result = await applyProfessionTeamBuilder(gate.allianceId, {
      professionFills,
      assignments,
    });
    await writeOfficerActionAudit({
      sessionId: gate.session.id,
      allianceId: gate.allianceId,
      hqUserId: gate.session.hqUserId,
      action: "professions.team_builder",
      severity: "routine",
      permission: ALLIANCE_ADMIN_PERMISSION,
      resourceType: "wl_eng_assignment",
      metadata: {
        assigned: result.assigned,
        moved: result.moved,
        professionFills: professionFills.length,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
