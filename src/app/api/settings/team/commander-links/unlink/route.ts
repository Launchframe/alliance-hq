import { NextResponse } from "next/server";
import { z } from "zod";

import {
  resolveSessionAllianceId,
  sessionHasMembershipForAlliance,
} from "@/lib/alliance/session-memberships";
import {
  unlinkCommanderDiscordLinks,
  unlinkCommanderHqAccount,
} from "@/lib/member-link/unlink.server";
import { getRbacContext } from "@/lib/rbac/context";
import {
  ensureCurrentAllianceForSession,
  loadSession,
  readSessionId,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ashedMemberId: z.string().trim().min(1).max(64),
  target: z.enum(["hq", "discord"]),
});

/**
 * Break-glass unlink of a roster commander's HQ or Discord member links.
 * Restricted to the alliance owner or a platform maintainer (player-uid-privacy:
 * relinking a claimed Commander requires account-level / owner break-glass with
 * audit). The action is recorded in the audit log by the server module.
 */
export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedSession = await ensureCurrentAllianceForSession(session);
  const allianceId = resolveSessionAllianceId(resolvedSession);
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isBreakGlass = ctx.isPlatformMaintainer || ctx.roleName === "owner";
  if (!isBreakGlass) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await sessionHasMembershipForAlliance(ctx.hqUserId, allianceId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result =
    body.target === "hq"
      ? await unlinkCommanderHqAccount({
          sessionId,
          actorHqUserId: ctx.hqUserId,
          allianceId,
          ashedMemberId: body.ashedMemberId,
        })
      : await unlinkCommanderDiscordLinks({
          sessionId,
          actorHqUserId: ctx.hqUserId,
          allianceId,
          ashedMemberId: body.ashedMemberId,
        });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Nothing to unlink.", code: result.reason },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, target: result.target, removed: result.removed });
}
