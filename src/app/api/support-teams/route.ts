import { after } from "next/server";
import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { commandRequestSchema } from "@/lib/support-teams/api.shared";
import { executeSupportCommand, reconcileSupportMemberships, supportSnapshot } from "@/lib/support-teams/service.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function GET() {
  try {
    const access = await requireSupportAccess();
    const snapshot = await supportSnapshot(access);
    if (snapshot.teams.length) after(async () => { await reconcileSupportMemberships(access.actor.allianceId); });
    return privateJson(snapshot);
  }
  catch (error) { return supportErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireSupportAccess("write");
    const input = commandRequestSchema.parse(await request.json());
    return privateJson(await executeSupportCommand(access, input.command, input.idempotencyKey));
  } catch (error) { return supportErrorResponse(error); }
}
