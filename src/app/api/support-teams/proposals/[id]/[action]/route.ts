import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { proposalActionSchema } from "@/lib/support-teams/proposal-api.shared";
import { executeProposalCommand } from "@/lib/support-teams/proposal.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";
import type { ProposalCommand } from "@/lib/support-teams/proposal.shared";

export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    const access = await requireSupportAccess("write");
    const { id, action } = await context.params;
    const { idempotencyKey, ...body } = proposalActionSchema.parse({ ...await request.json(), action });
    const kinds = { move: "moveProposal", swap: "swapProposal", submit: "submitProposal", approve: "approveProposal", publish: "publishProposal", cancel: "cancelProposal" } as const;
    const { action: parsedAction, ...input } = body;
    const command = { ...input, kind: kinds[parsedAction], proposalId: id } as ProposalCommand;
    return privateJson(await executeProposalCommand(access, command, idempotencyKey));
  } catch (error) { return supportErrorResponse(error); }
}
