import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { loadUndoPreview } from "@/lib/support-teams/service.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function POST(_request: Request, context: { params: Promise<{ actionId: string }> }) {
  try {
    const access = await requireSupportAccess("write");
    const { actionId } = await context.params;
    return privateJson(await loadUndoPreview(access, actionId));
  } catch (error) { return supportErrorResponse(error); }
}
