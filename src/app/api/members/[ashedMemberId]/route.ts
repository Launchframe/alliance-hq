import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertCommanderReadAccess,
  CommanderAccessError,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";
import { loadCommanderProfile } from "@/lib/members/commander-profile.server";
import {
  resolveMemberCommanderNameConflict,
} from "@/lib/members/commander-identity.server";
import {
  CommanderIdentityConflictError,
  commanderConflictResponseBody,
} from "@/lib/members/commander-identity-conflicts.shared";
import { getRbacContext } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  currentName: z.string().trim().min(1).max(120),
});

type Props = {
  params: Promise<{ ashedMemberId: string }>;
};

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { ashedMemberId } = await params;
    const trimmed = ashedMemberId.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Member id required." }, { status: 400 });
    }

    const profile = await loadCommanderProfile(session.id, trimmed);
    if (!profile) {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof CommanderAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load commander profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { allianceId } = await resolveCommanderSessionContext(session.id);
    await assertCommanderReadAccess(session.id, allianceId);

    const ctx = await getRbacContext(session.id);
    if (!ctx?.isPlatformMaintainer && !ctx?.permissions.has("members:write")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { ashedMemberId } = await params;
    const trimmedId = ashedMemberId.trim();
    if (!trimmedId) {
      return NextResponse.json({ error: "Member id required." }, { status: 400 });
    }

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const result = await resolveMemberCommanderNameConflict({
      allianceId,
      ashedMemberId: trimmedId,
      currentName: body.currentName,
    });

    if (result.status === "deferred") {
      if (result.conflict) {
        return NextResponse.json(
          commanderConflictResponseBody([result.conflict]),
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: "Commander sync is still pending." },
        { status: 422 },
      );
    }

    return NextResponse.json({ ok: true, commanderId: result.commanderId });
  } catch (error) {
    if (error instanceof CommanderIdentityConflictError) {
      return NextResponse.json(
        commanderConflictResponseBody(error.conflicts),
        { status: 422 },
      );
    }
    if (error instanceof CommanderAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to update member name.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
