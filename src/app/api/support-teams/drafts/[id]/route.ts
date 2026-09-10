import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { loadDraftSnapshot } from "@/lib/support-teams/draft.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return privateJson(await loadDraftSnapshot(await requireSupportAccess("read"), (await context.params).id)); }
  catch (error) { return supportErrorResponse(error); }
}
