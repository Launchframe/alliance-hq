import { after, NextResponse } from "next/server";
import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { commandRequestSchema } from "@/lib/support-teams/api.shared";
import { executeSupportCommand, reconcileSupportMemberships, supportSnapshot } from "@/lib/support-teams/service.server";
import { readDisplayPreferences } from "@/lib/support-teams/display-preferences.server";
import { resolveTeamInviteAccess } from "@/lib/native-alliance/team-invites.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function GET(request: Request) {
  try {
    const access = await requireSupportAccess();
    const snapshot = await supportSnapshot(access);
    if (snapshot.teams.length) after(async () => { await reconcileSupportMemberships(access.actor.allianceId); });
    if (new URL(request.url).searchParams.get("bootstrap") === "1") {
      const [preferences, inviteAccess] = await Promise.all([readDisplayPreferences(access.actor.principalId), resolveTeamInviteAccess(access.sessionId)]);
      const canInvite = !(inviteAccess instanceof NextResponse) && inviteAccess.allianceId === access.actor.allianceId && inviteAccess.assignableRoles.includes("member");
      return privateJson({ ...snapshot, preferences, canInvite });
    }
    return privateJson(snapshot);
  }
  catch (error) { return supportErrorResponse(error); }
}
export async function POST(request: Request) {
  let kind: string | undefined;
  try {
    const access = await requireSupportAccess("write");
    const input = commandRequestSchema.parse(await request.json());
    kind = input.command.kind;
    return privateJson(await executeSupportCommand(access, input.command, input.idempotencyKey));
  } catch (error) { return supportErrorResponse(error, kind === "publishSetup" ? "supportTeams.publishIncomplete" : undefined); }
}
