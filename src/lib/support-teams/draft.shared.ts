import { assertWriter, balancedTargets, boardKey, fieldKey, fieldVersion, lifecycleKeys, memberTeam, readField, recordChanges, teamIds, teamLead } from "./policy.shared";
import { SupportError, type EventIdentity, type SupportActor, type SupportBoard, type SupportRosterMember, type SupportValue } from "./types.shared";

export type DraftConfig = { startsAt: string; endsAt: string; roundMinutes: number };
export type DraftPick = { teamId: string; memberId: string; expectedRound: number; expectedRoundVersion: number; expectedSlotVersion: number; expectedMemberVersion: number };
export type DraftCommand =
  | ({ kind: "scheduleDraft"; draftId: string; expectedVersion: number } & DraftConfig)
  | ({ kind: "draftPick"; draftId: string } & DraftPick)
  | { kind: "extendDraft"; draftId: string; expectedVersion: number; endsAt: string }
  | { kind: "publishDraft"; draftId: string; expectedVersion: number; allowUnsorted: boolean }
  | { kind: "cancelDraft"; draftId: string; expectedVersion: number };
export const draftKey = (id: string, field: string) => fieldKey("draft", id, field);
export const draftMemberKey = (id: string, member: string, field = "team") => fieldKey(`draftMember:${id}`, member, field);
export const draftTeamKey = (id: string, team: string, field: string) => fieldKey(`draftTeam:${id}`, team, field);
export const draftSlotKey = (id: string, round: number, team: string) => fieldKey(`draftSlot:${id}:${round}`, team, "member");
const baseKey = (id: string, member: string) => fieldKey(`draftBase:${id}`, member, "team");
const eligible = (m: SupportRosterMember) => m.rank === 4 || m.rank === 5;
export const draftRosterFingerprint = (roster: SupportRosterMember[]) => `roster:${JSON.stringify([...roster].sort((a, b) => a.id.localeCompare(b.id)).map((m) => [m.id, m.rank, m.draftStintToken ?? null]))}`;
const draftTeams = (board: SupportBoard, id: string): string[] => Object.entries(board.fields).flatMap(([key, value]) => { const [r, team, f] = JSON.parse(key); return r === `draftTeam:${id}` && f === "lead" && typeof value.value === "string" ? [team as string] : []; }).sort();
const configFor = (board: SupportBoard, id: string): DraftConfig => ({ startsAt: String(readField(board, draftKey(id, "startsAt"))), endsAt: String(readField(board, draftKey(id, "endsAt"))), roundMinutes: Number(readField(board, draftKey(id, "roundMinutes"))) });
export function draftPhase(board: SupportBoard, id: string, now: number) {
  const status = readField(board, draftKey(id, "status"));
  if (status === "published" || status === "canceled") return status;
  if (status !== "open" && status !== "ready") throw new SupportError("changed");
  const config = configFor(board, id);
  if (now >= Date.parse(config.endsAt)) return "expired";
  if (now < Date.parse(config.startsAt)) return "scheduled";
  return status === "ready" ? "ready" : "open";
}
const draftReads = (board: SupportBoard, id: string) => [...lifecycleKeys(board), ...["status", "round", "roundStartedAt", "startsAt", "endsAt", "roundMinutes", "rosterFingerprint"].map((f) => draftKey(id, f))];
function assertRoster(board: SupportBoard, roster: SupportRosterMember[], id: string) {
  if (readField(board, draftKey(id, "rosterFingerprint")) !== draftRosterFingerprint(roster)) throw new SupportError("memberUnavailable");
  const teams = draftTeams(board, id);
  const leads = teams.map((team) => readField(board, draftTeamKey(id, team, "lead")));
  if (new Set(leads).size !== leads.length || leads.length !== roster.filter(eligible).length || leads.some((lead) => !roster.some((m) => m.id === lead && eligible(m)))) throw new SupportError("leadRequired");
  for (const team of teams) {
    if (teamIds(board).includes(team) && teamLead(board, team) !== readField(board, draftTeamKey(id, team, "lead"))) throw new SupportError("leadRequired");
  }
}
function assertWorkspace(board: SupportBoard, id: string) {
  if (board.construction?.kind !== "draft" || board.construction.id !== id) throw new SupportError("notOpen");
}
export function draftSnapshot(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, id: string, now = Date.now()) {
  if (!actor.canRead || actor.allianceId !== board.allianceId || !actor.principalId) throw new SupportError("forbidden");
  const phase = draftPhase(board, id, now);
  const config = configFor(board, id);
  const currentRound = Number(readField(board, draftKey(id, "round")));
  const deadline = new Date(Math.min(Date.parse(config.endsAt), Date.parse(String(readField(board, draftKey(id, "roundStartedAt")))) + config.roundMinutes * 60000)).toISOString();
  let rosterValid = true;
  try { assertRoster(board, roster, id); } catch { rosterValid = false; }
  const memberLocations = Object.fromEntries(roster.map((m) => [m.id, readField(board, draftMemberKey(id, m.id, "stint")) === (m.draftStintToken ?? null) ? readField(board, draftMemberKey(id, m.id)) as string | null : null]));
  const teams = draftTeams(board, id).map((teamId) => {
    const leadId = String(readField(board, draftTeamKey(id, teamId, "lead")));
    const target = Number(readField(board, draftTeamKey(id, teamId, "target")));
    const picked = readField(board, draftSlotKey(id, currentRound, teamId)) !== null;
    const applicable = currentRound < target;
    const proxy = !actor.linkedMemberIds.includes(leadId);
    const pickBlocked = !actor.canWrite ? "forbidden" : !rosterValid ? "memberUnavailable" : phase !== "open" ? "notOpen" : picked ? "changed" : !applicable ? "teamFull" : proxy && !actor.override && now < Date.parse(deadline) ? "proxyEarly" : null;
    return { id: teamId, name: readField(board, fieldKey("team", teamId, "name")) as string | null, leadId, target, memberIds: roster.filter((m) => memberLocations[m.id] === teamId).map((m) => m.id), picked, applicable, proxy, canPick: pickBlocked === null, pickBlocked, slotVersion: fieldVersion(board, draftSlotKey(id, currentRound, teamId)) };
  });
  return { id, phase, config, currentRound, deadline, serverNow: new Date(now).toISOString(), teams, memberLocations, roster, rosterValid, version: board.version, resourceVersions: { round: fieldVersion(board, draftKey(id, "round")), members: Object.fromEntries(roster.map((m) => [m.id, fieldVersion(board, draftMemberKey(id, m.id))])) }, actor: { canWrite: actor.canWrite, canManage: actor.canWrite && actor.override, linkedMemberIds: actor.linkedMemberIds }, publishedBase: { version: Number(readField(board, draftKey(id, "baseVersion"))), published: readField(board, draftKey(id, "basePublished")) === true, memberLocations: Object.fromEntries(roster.map((m) => [m.id, readField(board, baseKey(id, m.id)) as string | null])) } };
}
export type DraftSnapshot = ReturnType<typeof draftSnapshot>;

export function applyDraftCommand(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, command: DraftCommand, identity: EventIdentity) {
  assertWriter(board, actor);
  const now = Date.parse(identity.at);
  const id = command.draftId;
  const changes: Record<string, SupportValue> = {};
  const reads = new Set<string>(lifecycleKeys(board));
  let representedLeadId: string | undefined;
  let round: number | undefined;
  if (command.kind !== "draftPick") {
    if (command.kind !== "scheduleDraft" && !actor.override) throw new SupportError("forbidden");
    if (command.expectedVersion !== board.version) throw new SupportError("changed");
  }
  if (command.kind === "scheduleDraft") {
    if (board.construction || readField(board, draftKey(id, "status")) !== null) throw new SupportError("changed");
    const starts = Date.parse(command.startsAt), ends = Date.parse(command.endsAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts <= now || ends <= starts || !Number.isInteger(command.roundMinutes) || command.roundMinutes < 1 || command.roundMinutes > 1440) throw new SupportError("changed");
    const existing = teamIds(board);
    const leads = roster.filter(eligible).sort((a, b) => a.id.localeCompare(b.id));
    if (!leads.length || existing.some((team) => !leads.some((lead) => lead.id === teamLead(board, team)))) throw new SupportError("leadRequired");
    const teams = leads.map((lead, index) => ({ id: existing.find((team) => teamLead(board, team) === lead.id) ?? `draft-${id}-${index + 1}`, lead: lead.id })).sort((a, b) => a.id.localeCompare(b.id));
    const targets = balancedTargets(roster.length, teams.map((t) => t.id));
    Object.assign(changes, { [boardKey(board, "published")]: board.published, [boardKey(board, "constructionKind")]: "draft", [boardKey(board, "constructionId")]: id, [draftKey(id, "startsAt")]: new Date(starts).toISOString(), [draftKey(id, "endsAt")]: new Date(ends).toISOString(), [draftKey(id, "roundMinutes")]: command.roundMinutes, [draftKey(id, "round")]: 1, [draftKey(id, "roundStartedAt")]: new Date(starts).toISOString(), [draftKey(id, "status")]: roster.length === leads.length ? "ready" : "open", [draftKey(id, "rosterFingerprint")]: draftRosterFingerprint(roster), [draftKey(id, "baseVersion")]: board.version, [draftKey(id, "basePublished")]: board.published });
    for (const member of roster) {
      changes[draftMemberKey(id, member.id)] = teams.find((team) => team.lead === member.id)?.id ?? null;
      changes[draftMemberKey(id, member.id, "stint")] = member.draftStintToken ?? null;
      changes[baseKey(id, member.id)] = memberTeam(board, member.id);
      reads.add(fieldKey("member", member.id, "team"));
    }
    for (const team of teams) {
      changes[draftTeamKey(id, team.id, "lead")] = team.lead;
      changes[draftTeamKey(id, team.id, "target")] = targets[team.id];
      reads.add(fieldKey("team", team.id, "exists"));
      reads.add(fieldKey("team", team.id, "lead"));
    }
  } else {
    assertWorkspace(board, id);
    draftReads(board, id).forEach((key) => reads.add(key));
    const phase = draftPhase(board, id, now);
    if (command.kind === "cancelDraft") {
      Object.keys(board.fields).filter((key) => { const [resource] = JSON.parse(key); return resource === `draftMember:${id}` || resource.startsWith(`draftSlot:${id}:`); }).forEach((key) => reads.add(key));
      changes[draftKey(id, "status")] = "canceled";
      changes[boardKey(board, "constructionKind")] = null;
      changes[boardKey(board, "constructionId")] = null;
    } else if (command.kind === "extendDraft") {
      const ends = Date.parse(command.endsAt);
      if (!Number.isFinite(ends) || ends <= now || ends <= Date.parse(configFor(board, id).endsAt)) throw new SupportError("changed");
      changes[draftKey(id, "endsAt")] = new Date(ends).toISOString();
    } else {
      assertRoster(board, roster, id);
      const view = draftSnapshot(board, roster, actor, id, now);
      round = view.currentRound;
      if (command.kind === "draftPick") {
        if (phase !== "open") throw new SupportError("notOpen");
        const team = view.teams.find((t) => t.id === command.teamId);
        if (!team || command.expectedRound !== round || command.expectedRoundVersion !== view.resourceVersions.round || command.expectedSlotVersion !== team.slotVersion || command.expectedMemberVersion !== view.resourceVersions.members[command.memberId]) throw new SupportError("changed");
        if (roster.some((m) => m.id === command.memberId && eligible(m))) throw new SupportError("leadRequired");
        if (!roster.some((m) => m.id === command.memberId)) throw new SupportError("memberUnavailable");
        if (view.memberLocations[command.memberId] !== null || team.picked) throw new SupportError("changed");
        if (!team.applicable) throw new SupportError("teamFull");
        if (!team.canPick) throw new SupportError(team.pickBlocked === "proxyEarly" ? "proxyEarly" : "forbidden", { deadline: view.deadline });
        representedLeadId = team.leadId;
        changes[draftMemberKey(id, command.memberId)] = team.id;
        changes[draftSlotKey(id, round, team.id)] = command.memberId;
        reads.add(draftTeamKey(id, team.id, "lead"));
        reads.add(draftTeamKey(id, team.id, "target"));
      } else {
        if (phase === "scheduled") throw new SupportError("notOpen");
        if (!command.allowUnsorted && Object.values(view.memberLocations).some((team) => team === null)) throw new SupportError("changed");
        for (const member of roster) {
          if (memberTeam(board, member.id) !== readField(board, baseKey(id, member.id))) throw new SupportError("changed");
          changes[fieldKey("member", member.id, "team")] = view.memberLocations[member.id];
          reads.add(draftMemberKey(id, member.id));
          reads.add(baseKey(id, member.id));
        }
        for (const team of view.teams) {
          if (team.memberIds.length > team.target || !team.memberIds.includes(team.leadId)) throw new SupportError("invalid");
          changes[fieldKey("team", team.id, "exists")] = true;
          changes[fieldKey("team", team.id, "lead")] = team.leadId;
          reads.add(draftTeamKey(id, team.id, "lead"));
          reads.add(draftTeamKey(id, team.id, "target"));
        }
        changes[boardKey(board, "published")] = true;
        changes[boardKey(board, "constructionKind")] = null;
        changes[boardKey(board, "constructionId")] = null;
        changes[draftKey(id, "status")] = "published";
      }
    }
  }
  const result = recordChanges(board, actor, changes, [...reads], { mode: "draft", draftId: id, round, representedLeadId }, command.kind, identity);
  result.event.teamIds = command.kind === "draftPick" ? [command.teamId] : draftTeams(result.board, id);
  result.event.memberIds = command.kind === "draftPick" ? [command.memberId] : roster.map((member) => member.id);
  result.event.teamNames = Object.fromEntries(result.event.teamIds.map((team) => [team, readField(board, fieldKey("team", team, "name")) as string | null]));
  return result;
}

export function advanceDraft(board: SupportBoard, roster: SupportRosterMember[], id: string, sourceActionId: string, identity: EventIdentity) {
  const now = Date.parse(identity.at);
  if (board.construction?.id !== id || draftPhase(board, id, now) !== "open") return null;
  const service: SupportActor = { allianceId: board.allianceId, principalId: "service:support-team-draft", displayName: null, canRead: true, canWrite: true, override: true, linkedMemberIds: [] };
  const view = draftSnapshot(board, roster, service, id, now);
  if (!view.rosterValid || view.teams.some((team) => team.applicable && !team.picked)) return null;
  const done = Object.values(view.memberLocations).every((team) => team !== null);
  const changes = done ? { [draftKey(id, "status")]: "ready" } : { [draftKey(id, "round")]: view.currentRound + 1, [draftKey(id, "roundStartedAt")]: identity.at };
  const result = recordChanges(board, service, changes, [...draftReads(board, id), ...view.teams.filter((team) => team.applicable).map((team) => draftSlotKey(id, view.currentRound, team.id))], { mode: "draft", draftId: id, round: view.currentRound, sourceActionId }, "advanceDraft", identity);
  result.event.principalType = "service";
  result.event.actorType = "service";
  return result;
}

export function validateDraftRestoration(board: SupportBoard, roster: SupportRosterMember[], changedKeys: string[], now: number) {
  const id = board.construction?.kind === "draft" ? board.construction.id : null;
  if (!id) return;
  const affectsWorkspace = changedKeys.some((key) => {
    const [resource, resourceId, field] = JSON.parse(key) as string[];
    return (resource === "draft" && resourceId === id) || resource === `draftMember:${id}` || resource === `draftTeam:${id}` || resource.startsWith(`draftSlot:${id}:`) || resource === "board" || (resource === "team" && field !== "name") || resource === "member";
  });
  if (!affectsWorkspace) return;
  assertRoster(board, roster, id);
  if (draftPhase(board, id, now) === "expired") throw new SupportError("notOpen");
  const view = draftSnapshot(board, roster, { allianceId: board.allianceId, principalId: "validation", canRead: true, canWrite: false, override: false, linkedMemberIds: [] }, id, now);
  const ids = new Set(view.teams.map((t) => t.id));
  for (const team of view.teams) if (!team.memberIds.includes(team.leadId) || team.memberIds.length > team.target) throw new SupportError("invalid");
  for (const [memberId, team] of Object.entries(view.memberLocations)) if (team !== null && (!ids.has(team) || !roster.some((m) => m.id === memberId))) throw new SupportError("invalid");
  for (const key of changedKeys) {
    const [resource, memberId] = JSON.parse(key) as string[];
    if (resource === `draftMember:${id}` && readField(board, key) !== null && !roster.some((m) => m.id === memberId)) throw new SupportError("invalid");
  }
  for (let round = 1; round <= view.currentRound; round++) {
    for (const team of view.teams) {
      const picked = readField(board, draftSlotKey(id, round, team.id));
      if (picked !== null && (view.memberLocations[String(picked)] !== team.id || roster.some((m) => m.id === picked && eligible(m)))) throw new SupportError("invalid");
      if (round < view.currentRound && round < team.target && picked === null) throw new SupportError("invalid");
    }
  }
}
