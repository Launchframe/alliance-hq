import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { commandRequestSchema } from "@/lib/support-teams/api.shared";
import { executeSupportCommand, supportSnapshot } from "@/lib/support-teams/service.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function GET() {
  try { return privateJson(await supportSnapshot(await requireSupportAccess())); }
  catch (error) { return supportErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireSupportAccess("write");
    const input = commandRequestSchema.parse(await request.json());
    return privateJson(await executeSupportCommand(access, input.command, input.idempotencyKey));
  } catch (error) { return supportErrorResponse(error); }
}
