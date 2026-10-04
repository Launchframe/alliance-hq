import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { loadProposalSnapshots } from "@/lib/support-teams/proposal.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireSupportAccess("read");
    return privateJson((await loadProposalSnapshots(access, (await context.params).id))[0]);
  } catch (error) { return supportErrorResponse(error); }
}
