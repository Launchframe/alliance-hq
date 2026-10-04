import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { createProposalSchema } from "@/lib/support-teams/proposal-api.shared";
import { executeProposalCommand, loadProposalSnapshots } from "@/lib/support-teams/proposal.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export async function GET() {
  try { return privateJson({ proposals: await loadProposalSnapshots(await requireSupportAccess("read")) }); }
  catch (error) { return supportErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireSupportAccess("write");
    const { idempotencyKey, expectedVersion } = createProposalSchema.parse(await request.json());
    const result = await executeProposalCommand(access, { kind: "createProposal", proposalId: idempotencyKey, expectedVersion }, idempotencyKey);
    return privateJson({ ...result, proposalId: idempotencyKey });
  } catch (error) { return supportErrorResponse(error); }
}
