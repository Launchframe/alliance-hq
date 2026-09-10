import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { undoRequestSchema } from "@/lib/support-teams/api.shared";
import { executeSupportUndo } from "@/lib/support-teams/service.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function POST(request: Request, context: { params: Promise<{ actionId: string }> }) {
  try {
    const access = await requireSupportAccess("write");
    const { actionId } = await context.params;
    const { idempotencyKey, ...preview } = undoRequestSchema.parse(await request.json());
    return privateJson(await executeSupportUndo(access, { ...preview, rootActionId: actionId }, idempotencyKey));
  } catch (error) { return supportErrorResponse(error); }
}
