import { assertWriter, balancedTargets, boardKey, fieldKey, fieldVersion, memberTeam, readField, recordChanges, teamIds, teamLead } from "./policy.shared";
import { draftRosterFingerprint } from "./draft.shared";
import { SupportError, type EventIdentity, type SupportActor, type SupportBoard, type SupportRosterMember, type SupportValue } from "./types.shared";

export type ProposalCommand = { proposalId: string; expectedVersion: number } & (
  | { kind: "createProposal" }
  | { kind: "submitProposal" }
  | { kind: "approveProposal" }
  | { kind: "cancelProposal" }
  | { kind: "moveProposal"; memberId: string; from: string | null; to: string | null }
  | { kind: "swapProposal"; memberId: string; otherMemberId: string; from: string; to: string }
  | { kind: "publishProposal"; expectedPublishedVersion: number; override: boolean }
);
export const proposalKey = (id: string, field: string) => fieldKey("proposal", id, field);
export const proposalMemberKey = (id: string, member: string, field = "team") => fieldKey(`proposalMember:${id}`, member, field);
export const proposalTeamKey = (id: string, team: string) => fieldKey(`proposalTeam:${id}`, team, "lead");
export const proposalVoteKey = (id: string, principal: string) => fieldKey(`proposalVote:${id}`, principal, "basis");
export const proposalIds = (board: SupportBoard) => Object.entries(board.fields).flatMap(([key, field]) => { const [r, id, f] = JSON.parse(key); return r === "proposal" && f === "status" && field.value !== null ? [String(id)] : []; }).sort();
const eligible = (m: SupportRosterMember) => m.rank === 4 || m.rank === 5;
const teamsFor = (board: SupportBoard, id: string) => Object.keys(board.fields).flatMap((key) => { const [r, team] = JSON.parse(key); return r === `proposalTeam:${id}` && typeof readField(board, key) === "string" ? [String(team)] : []; }).sort();
const votersFor = (roster: SupportRosterMember[]) => roster.filter((m) => m.rank === 4);
export const proposalElectorateFingerprint = (roster: SupportRosterMember[]) => `electorate:${JSON.stringify(votersFor(roster).sort((a, b) => a.id.localeCompare(b.id)).map((m) => [m.id, m.draftStintToken ?? null, m.proposalIdentityToken ?? null, [...new Set(m.proposalVoterIds ?? [])].sort()]))}`;
const basisFor = (board: SupportBoard, roster: SupportRosterMember[], id: string) => `proposal:${JSON.stringify([fieldVersion(board, proposalKey(id, "contentVersion")), draftRosterFingerprint(roster), proposalElectorateFingerprint(roster)])}`;
const workspaceKeys = (board: SupportBoard, id: string) => Object.keys(board.fields).filter((key) => { const [r, resourceId] = JSON.parse(key); return (r === "proposal" && resourceId === id) || r === `proposalMember:${id}` || r === `proposalTeam:${id}`; });

export function proposalSnapshot(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, id: string) {
  if (!actor.canRead || !actor.principalId || actor.allianceId !== board.allianceId) throw new SupportError("forbidden");
  const phase = readField(board, proposalKey(id, "status"));
  if (phase !== "editing" && phase !== "submitted" && phase !== "published" && phase !== "canceled") throw new SupportError("changed");
  const ids = teamsFor(board, id);
  const targets = balancedTargets(roster.length, ids);
  const memberLocations: Record<string, string | null> = Object.fromEntries(roster.map((m) => [m.id, readField(board, proposalMemberKey(id, m.id, "stint")) === (m.draftStintToken ?? null) ? readField(board, proposalMemberKey(id, m.id)) as string | null : null]));
  const teams = ids.map((team) => ({ id: team, name: readField(board, fieldKey("team", team, "name")) as string | null, leadId: String(readField(board, proposalTeamKey(id, team))), target: targets[team], memberIds: roster.filter((m) => memberLocations[m.id] === team).map((m) => m.id) }));
  const complete = roster.length > 0 && new Set(roster.map((m) => m.id)).size === roster.length && teams.length > 0 && new Set(teams.map((t) => t.leadId)).size === teams.length && teams.length === roster.filter(eligible).length && teams.every((t) => roster.some((m) => m.id === t.leadId && eligible(m)) && memberLocations[t.leadId] === t.id && t.memberIds.length === t.target) && Object.values(memberLocations).every((team) => team !== null && ids.includes(team));
  const electorate = votersFor(roster);
  const identityReviewRequired = electorate.some((m) => new Set(m.proposalVoterIds ?? []).size > 1);
  const basis = basisFor(board, roster, id);
  const invalidated = readField(board, proposalKey(id, "approvalBasis")) !== null && readField(board, proposalKey(id, "approvalBasis")) !== basis;
  const approvedPrincipals = new Set(Object.entries(board.fields).flatMap(([key, field]) => { const [r, principal] = JSON.parse(key); return r === `proposalVote:${id}` && field.value === basis && electorate.some((m) => m.proposalVoterIds?.includes(principal)) && !String(principal).startsWith("discord:") ? [String(principal)] : []; }));
  const approved = invalidated || identityReviewRequired ? 0 : approvedPrincipals.size;
  const required = Math.floor(electorate.length / 2) + 1;
  const publishedVersion = fieldVersion(board, boardKey(board, "published"));
  const stale = phase !== "published" && readField(board, proposalKey(id, "basePublishedVersion")) !== publishedVersion;
  const active = (phase === "editing" || phase === "submitted") && !stale && board.construction?.kind === "proposal";
  const canEdit = actor.canWrite && active;
  return { id, version: board.version, proposalVersion: fieldVersion(board, proposalKey(id, "contentVersion")), contentVersion: fieldVersion(board, proposalKey(id, "contentVersion")), publishedVersion, phase, stale, invalidated, complete, teams, memberLocations, publishedMemberLocations: Object.fromEntries(roster.map((member) => [member.id, memberTeam(board, member.id)])), roster: roster.map((m) => { const visible = { ...m }; delete visible.draftStintToken; delete visible.proposalVoterIds; delete visible.proposalIdentityToken; return visible; }), electorateCount: electorate.length, required, approved, identityReviewRequired, canEdit, canApprove: canEdit && phase === "submitted" && !invalidated && !identityReviewRequired && electorate.some((m) => m.proposalVoterIds?.includes(actor.principalId)) && !approvedPrincipals.has(actor.principalId), canPublish: canEdit && phase === "submitted" && complete && !invalidated && !identityReviewRequired && electorate.length > 0 && approved >= required, canOverride: canEdit && actor.override && complete && phase === "submitted" && !invalidated, canCancel: actor.canWrite && (phase === "editing" || phase === "submitted") };
}
export type ProposalSnapshot = ReturnType<typeof proposalSnapshot>;

export function applyProposalCommand(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, command: ProposalCommand, identity: EventIdentity) {
  assertWriter(board, actor);
  const id = command.proposalId;
  const changes: Record<string, SupportValue> = {};
  const reads = new Set<string>();
  const contentKey = proposalKey(id, "contentVersion");
  const statusKey = proposalKey(id, "status");
  if (command.kind === "createProposal") {
    if (command.expectedVersion !== board.version || board.fields[statusKey] || board.construction?.kind === "draft") throw new SupportError("changed");
    const leads = roster.filter(eligible).sort((a, b) => a.id.localeCompare(b.id));
    const existing = teamIds(board);
    if (!leads.length || existing.length > leads.length) throw new SupportError("leadRequired");
    const unused = new Set(leads.map((m) => m.id));
    const teams = existing.map((team) => { const lead = teamLead(board, team); if (lead && unused.has(lead)) { unused.delete(lead); return { id: team, lead }; } return { id: team, lead: null as string | null }; });
    for (const team of teams) if (!team.lead) { team.lead = [...unused][0]; unused.delete(team.lead); }
    for (const lead of unused) teams.push({ id: `proposal:${id}:${lead}`, lead });
    for (const team of teams) { changes[proposalTeamKey(id, team.id)] = team.lead; reads.add(fieldKey("team", team.id, "exists")); reads.add(fieldKey("team", team.id, "lead")); }
    for (const member of roster) {
      changes[proposalMemberKey(id, member.id)] = teams.find((t) => t.lead === member.id)?.id ?? (existing.includes(memberTeam(board, member.id) ?? "") ? memberTeam(board, member.id) : null);
      changes[proposalMemberKey(id, member.id, "stint")] = member.draftStintToken ?? null;
      reads.add(fieldKey("member", member.id, "team"));
      reads.add(fieldKey("membership", member.id, "stint"));
    }
    changes[contentKey] = 1;
    changes[statusKey] = "editing";
    changes[proposalKey(id, "basePublishedVersion")] = fieldVersion(board, boardKey(board, "published"));
    reads.add(boardKey(board, "published"));
    if (!board.construction) { changes[boardKey(board, "constructionKind")] = "proposal"; changes[boardKey(board, "constructionId")] = id; }
  } else {
    const view = proposalSnapshot(board, roster, actor, id);
    if (command.expectedVersion !== view.proposalVersion) throw new SupportError("changed");
    reads.add(contentKey); reads.add(statusKey);
    if (!view.canCancel) throw new SupportError("changed");
    if (command.kind === "cancelProposal") {
      workspaceKeys(board, id).forEach((key) => reads.add(key));
      changes[statusKey] = "canceled";
      if (board.construction?.kind === "proposal" && board.construction.id === id) {
        const next = proposalIds(board).find((other) => other !== id && ["editing", "submitted"].includes(String(readField(board, proposalKey(other, "status")))) && readField(board, proposalKey(other, "basePublishedVersion")) === view.publishedVersion);
        changes[boardKey(board, "constructionKind")] = next ? "proposal" : null; changes[boardKey(board, "constructionId")] = next ?? null;
        if (next) reads.add(proposalKey(next, "status"));
      }
    } else {
      if (view.stale || board.construction?.kind !== "proposal") throw new SupportError("changed");
      reads.add(boardKey(board, "constructionKind")); reads.add(boardKey(board, "published")); reads.add(proposalKey(id, "basePublishedVersion"));
      for (const member of roster) reads.add(fieldKey("membership", member.id, "stint"));
      if (command.kind === "moveProposal" || command.kind === "swapProposal") {
        for (const memberId of [command.memberId, ...(command.kind === "swapProposal" ? [command.otherMemberId] : [])]) {
          if (!roster.some((m) => m.id === memberId)) throw new SupportError("memberUnavailable");
          if (view.teams.some((t) => t.leadId === memberId)) throw new SupportError("leadRequired");
        }
        if (command.from === command.to || view.memberLocations[command.memberId] !== command.from || (command.to !== null && !view.teams.some((t) => t.id === command.to))) throw new SupportError("changed");
        if (command.kind === "swapProposal") {
          if (command.memberId === command.otherMemberId || view.memberLocations[command.otherMemberId] !== command.to) throw new SupportError("changed");
          changes[proposalMemberKey(id, command.otherMemberId)] = command.from;
          changes[proposalMemberKey(id, command.otherMemberId, "stint")] = roster.find((m) => m.id === command.otherMemberId)!.draftStintToken ?? null;
        } else if (command.to && view.teams.find((t) => t.id === command.to)!.memberIds.length >= view.teams.find((t) => t.id === command.to)!.target) throw new SupportError("teamFull");
        changes[proposalMemberKey(id, command.memberId)] = command.to;
        changes[proposalMemberKey(id, command.memberId, "stint")] = roster.find((m) => m.id === command.memberId)!.draftStintToken ?? null;
        changes[contentKey] = view.contentVersion + 1; changes[statusKey] = "editing";
      } else if (command.kind === "approveProposal") {
        if (view.invalidated) throw new SupportError("changed");
        if (!view.canApprove) throw new SupportError(readField(board, proposalVoteKey(id, actor.principalId)) === basisFor(board, roster, id) ? "changed" : "forbidden");
        reads.add(proposalKey(id, "approvalBasis"));
        changes[proposalVoteKey(id, actor.principalId)] = basisFor(board, roster, id);
      } else {
        if (!view.complete) throw new SupportError("incomplete");
        workspaceKeys(board, id).forEach((key) => reads.add(key));
        if (command.kind === "submitProposal") {
          if (view.phase === "submitted" && !view.invalidated) throw new SupportError("changed");
          changes[statusKey] = "submitted"; changes[proposalKey(id, "approvalBasis")] = basisFor(board, roster, id);
        } else {
          if (command.expectedPublishedVersion !== view.publishedVersion || view.phase !== "submitted" || view.invalidated) throw new SupportError("changed");
          if (command.override ? !actor.override : !view.canPublish) throw new SupportError("forbidden");
          if (!command.override) Object.keys(board.fields).filter((key) => JSON.parse(key)[0] === `proposalVote:${id}`).forEach((key) => reads.add(key));
          for (const member of roster) changes[fieldKey("member", member.id, "team")] = view.memberLocations[member.id];
          for (const team of view.teams) {
            const existsKey = fieldKey("team", team.id, "exists"); const leadKey = fieldKey("team", team.id, "lead");
            reads.add(existsKey); reads.add(leadKey);
            if (readField(board, existsKey) !== true) changes[existsKey] = true;
            if (readField(board, leadKey) !== team.leadId) changes[leadKey] = team.leadId;
          }
          changes[boardKey(board, "published")] = true; changes[boardKey(board, "constructionKind")] = null; changes[boardKey(board, "constructionId")] = null;
          changes[statusKey] = "published"; changes[proposalKey(id, "ownerOverride")] = command.override;
        }
      }
    }
  }
  return recordChanges(board, actor, changes, [...reads], { mode: "proposal", proposalId: id, proposalVersion: fieldVersion(board, contentKey) + (contentKey in changes ? 1 : 0), ...(command.kind === "publishProposal" ? { ownerOverride: command.override } : {}) }, command.kind, identity);
}

export function validateProposalRestoration(board: SupportBoard, roster: SupportRosterMember[], changedKeys: string[]) {
  const touched = new Set(changedKeys.flatMap((key) => { const [resource, id] = JSON.parse(key); return resource === "proposal" ? [String(id)] : resource.startsWith("proposal") ? [String(resource).split(":").slice(1).join(":")] : []; }));
  for (const id of touched) {
    const phase = readField(board, proposalKey(id, "status"));
    if (phase === null || phase === "canceled") continue;
    const view = proposalSnapshot(board, roster, { allianceId: board.allianceId, principalId: "validation", canRead: true, canWrite: false, override: false, linkedMemberIds: [] }, id);
    if (phase === "published" && (!view.complete || (readField(board, proposalKey(id, "ownerOverride")) !== true && (view.invalidated || view.identityReviewRequired || view.approved < view.required)))) throw new SupportError("dependencies");
    for (const key of changedKeys) {
      const [resource, member, field] = JSON.parse(key);
      if (resource === `proposalMember:${id}` && field === "team" && readField(board, key) !== null && (!roster.some((m) => m.id === member) || view.memberLocations[member] === null)) throw new SupportError("memberUnavailable");
    }
  }
}
