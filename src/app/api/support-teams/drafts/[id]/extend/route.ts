import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { extendDraftSchema } from "@/lib/support-teams/draft-api.shared";
import { executeDraftCommand } from "@/lib/support-teams/draft.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireSupportAccess("write");
    const { idempotencyKey, ...input } = extendDraftSchema.parse(await request.json());
    return privateJson(await executeDraftCommand(access, { ...input, kind: "extendDraft", draftId: (await context.params).id }, idempotencyKey));
  } catch (error) { return supportErrorResponse(error); }
}
