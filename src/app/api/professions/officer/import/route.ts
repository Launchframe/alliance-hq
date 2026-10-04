import { NextResponse } from "next/server";

import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import {
  applyProfessionPairingImport,
  previewProfessionPairingImport,
} from "@/lib/professions/pairing-import.server";
import { ALLIANCE_ADMIN_PERMISSION } from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "alliance:admin");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const body = (await request.json()) as {
    text?: string;
    commit?: boolean;
  };
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json(
      { error: "Paste is required.", code: "paste_required" },
      { status: 400 },
    );
  }

  try {
    if (body.commit === true) {
      const result = await applyProfessionPairingImport(allianceId, text);
      await writeOfficerActionAudit({
        sessionId: session.id,
        allianceId,
        hqUserId: session.hqUserId,
        action: "professions.pairing_import",
        severity: "routine",
        permission: ALLIANCE_ADMIN_PERMISSION,
        resourceType: "wl_eng_assignment",
        metadata: {
          assigned: result.assigned,
          skipped: result.skipped,
          failed: result.failed,
        },
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const preview = await previewProfessionPairingImport(allianceId, text);
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
