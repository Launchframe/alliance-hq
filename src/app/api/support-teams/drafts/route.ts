import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { scheduleDraftSchema } from "@/lib/support-teams/draft-api.shared";
import { executeDraftCommand } from "@/lib/support-teams/draft.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function POST(request: Request) {
  try {
    const access = await requireSupportAccess("write");
    const { idempotencyKey, ...config } = scheduleDraftSchema.parse(await request.json());
    const result = await executeDraftCommand(access, { ...config, kind: "scheduleDraft", draftId: idempotencyKey }, idempotencyKey);
    return privateJson({ ...result, draftId: idempotencyKey });
  } catch (error) { return supportErrorResponse(error); }
}
