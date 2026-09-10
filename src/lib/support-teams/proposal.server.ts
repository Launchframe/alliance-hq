import "server-only";

import { getDb } from "@/lib/db";
import type { SupportAccess } from "./access.server";
import { withDraftStintTokens } from "./draft-roster.server";
import { bindStintAssignments, projectMemberships } from "./maintenance.server";
import { withProposalVoters } from "./proposal-roster.server";
import { applyProposalCommand, proposalIds, proposalSnapshot, type ProposalCommand } from "./proposal.shared";
import { loadBoard } from "./repository.server";
import { loadSupportRoster, loadSupportStints } from "./roster.server";
import { mutate } from "./service.server";
import { SupportError } from "./types.shared";

export async function executeProposalCommand(access: SupportAccess, command: ProposalCommand, idempotencyKey: string) {
  return mutate(access, command, idempotencyKey, (board, events, roster, actor, identity, originalVersion) => {
    if (command.kind === "createProposal" && (command.expectedVersion !== originalVersion || (originalVersion !== 0 && originalVersion !== board.version))) throw new SupportError("changed");
    const result = bindStintAssignments(board, actor, applyProposalCommand(board, roster, actor, command.kind === "createProposal" ? { ...command, expectedVersion: board.version } : command, identity));
    if (!actor.override && (command.kind === "moveProposal" || command.kind === "swapProposal")) {
      for (const patch of result.event.patches) {
        const writer = events.find((event) => event.id === board.fields[patch.key]?.actionId);
        if (patch.before !== patch.after && writer && writer.principalId !== actor.principalId && writer.patches.some((prior) => prior.key === patch.key && prior.before === patch.after && prior.after === patch.before)) throw new SupportError("forbidden");
      }
    }
    return result;
  });
}
export async function loadProposalSnapshots(access: SupportAccess, id?: string) {
  if (!access.actor.canRead) throw new SupportError("forbidden");
  return getDb().transaction(async (db) => {
    const stored = await loadBoard(db, access.actor.allianceId);
    const roster = await withProposalVoters(db, access.actor.allianceId, await withDraftStintTokens(db, access.actor.allianceId, await loadSupportRoster(access.actor.allianceId, db)));
    const board = projectMemberships(stored, roster, await loadSupportStints(access.actor.allianceId, db));
    return (id ? [id] : proposalIds(board)).map((proposalId) => proposalSnapshot(board, roster, access.actor, proposalId));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
