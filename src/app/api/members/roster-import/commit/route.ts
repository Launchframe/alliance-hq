import { NextResponse } from "next/server";
import { z } from "zod";

import { getRbacContext } from "@/lib/rbac/context";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { commitRosterImport } from "@/lib/native-alliance/roster-commit";
import {
  CommanderIdentityConflictError,
  commanderConflictResponseBody,
} from "@/lib/members/commander-identity-conflicts.shared";
import { readSessionId } from "@/lib/session";

const rowSchema = z.object({
  extractedName: z.string().trim().min(1),
  matchMemberId: z.string().trim().min(1).nullable(),
  allianceRank: z.number().int().min(1).max(5),
  allianceRankTitle: z.string().trim().nullable().optional(),
  heroPowerM: z.number().nullable().optional(),
  memberLevel: z.number().int().min(1).nullable().optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1),
  markAbsentInactive: z.boolean().optional(),
});

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx.isPlatformMaintainer && !ctx.permissions.has("members:write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!ctx.currentAllianceId) {
    return NextResponse.json(
      { error: "No alliance selected." },
      { status: 400 },
    );
  }

  if (!(await isNativeAlliance(ctx.currentAllianceId))) {
    return NextResponse.json(
      { error: "Roster import is only available for native alliances." },
      { status: 403 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await commitRosterImport({
      allianceId: ctx.currentAllianceId,
      sessionId,
      hqUserId: ctx.hqUserId,
      rows: body.rows,
      markAbsentInactive: body.markAbsentInactive,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CommanderIdentityConflictError) {
      return NextResponse.json(
        commanderConflictResponseBody(error.conflicts),
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Commit failed." },
      { status: 400 },
    );
  }
}
