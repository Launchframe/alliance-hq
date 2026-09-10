import { SupportError, type EventIdentity, type SupportActor, type SupportBoard, type SupportCommand, type SupportContext, type SupportErrorCode, type SupportEvent, type SupportRosterMember, type SupportValue } from "./types.shared";

export const SUPPORT_TEAM_NAME_MAX = 60;
export const fieldKey = (resource: string, id: string, field: string) => JSON.stringify([resource, id, field]);
export const readField = (board: SupportBoard, key: string): SupportValue => board.fields[key]?.value ?? null;
export const fieldVersion = (board: SupportBoard, key: string) => board.fields[key]?.version ?? 0;
export const emptyBoard = (allianceId: string): SupportBoard => ({ allianceId, version: 0, published: false, construction: null, fields: {} });
export function teamIds(board: SupportBoard): string[] {
  return Object.entries(board.fields).flatMap(([key, field]) => {
    const [resource, id, name] = JSON.parse(key) as string[];
    return resource === "team" && name === "exists" && field.value === true ? [id] : [];
  }).sort();
}
export function balancedTargets(rosterSize: number, teams: string[]): Record<string, number> {
  return Object.fromEntries([...teams].sort().map((id, i) => [id, Math.floor(rosterSize / teams.length) + (i < rosterSize % teams.length ? 1 : 0)]));
}
export const memberTeam = (board: SupportBoard, memberId: string) => readField(board, fieldKey("member", memberId, "team")) as string | null;
export const teamLead = (board: SupportBoard, teamId: string) => readField(board, fieldKey("team", teamId, "lead")) as string | null;
const eligible = (roster: SupportRosterMember[], id: string | null) => roster.some((m) => m.id === id && (m.rank === 4 || m.rank === 5));
export function assertWriter(board: SupportBoard, actor: SupportActor) {
  if (!actor.principalId || actor.allianceId !== board.allianceId || !actor.canWrite) throw new SupportError("forbidden");
}
function ownTeam(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, team: string) {
  const lead = teamLead(board, team);
  return lead !== null && actor.linkedMemberIds.includes(lead) && eligible(roster, lead);
}
function assertTeam(board: SupportBoard, team: string | null) {
  if (team !== null && readField(board, fieldKey("team", team, "exists")) !== true) throw new SupportError("changed");
}
function assertMovable(board: SupportBoard, roster: SupportRosterMember[], id: string) {
  if (!roster.some((m) => m.id === id)) throw new SupportError("memberUnavailable");
  if (teamIds(board).some((team) => teamLead(board, team) === id)) throw new SupportError("leadRequired");
}
function assertMaintenance(board: SupportBoard) {
  if (!board.published || board.construction !== null) throw new SupportError("changed");
}
function commandChanges(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, command: SupportCommand) {
  assertWriter(board, actor);
  if (command.expectedVersion !== board.version) throw new SupportError("changed");
  const changes: Record<string, SupportValue> = {};
  const reads = new Set<string>();
  const observeTeam = (id: string) => {
    reads.add(fieldKey("team", id, "exists"));
    if (!actor.override) reads.add(fieldKey("team", id, "lead"));
  };
  if (command.kind === "createTeam" || command.kind === "replaceLead") {
    if (board.construction !== null) throw new SupportError("changed");
    if (!actor.override && (command.kind === "createTeam" || !ownTeam(board, roster, actor, command.teamId))) throw new SupportError("forbidden");
    if (!eligible(roster, command.leadId)) throw new SupportError("leadRequired");
    const ids = teamIds(board);
    if (ids.some((id) => teamLead(board, id) === command.leadId)) throw new SupportError("leadRequired");
    const from = memberTeam(board, command.leadId);
    if (from !== null && from !== command.teamId) throw new SupportError("forbidden");
    if (command.kind === "createTeam") {
      if (board.fields[fieldKey("team", command.teamId, "exists")] !== undefined) throw new SupportError("changed");
      changes[fieldKey("team", command.teamId, "exists")] = true;
      changes[fieldKey("team", command.teamId, "name")] = null;
    } else {
      assertTeam(board, command.teamId);
      const previous = teamLead(board, command.teamId);
      if (previous) changes[fieldKey("member", previous, "team")] = null;
    }
    changes[fieldKey("team", command.teamId, "lead")] = command.leadId;
    changes[fieldKey("member", command.leadId, "team")] = command.teamId;
    observeTeam(command.teamId);
  } else if (command.kind === "rename") {
    assertTeam(board, command.teamId);
    if (!actor.override && !ownTeam(board, roster, actor, command.teamId)) throw new SupportError("forbidden");
    const name = command.name.trim();
    if (!name) throw new SupportError("nameRequired");
    if (name.length > SUPPORT_TEAM_NAME_MAX) throw new SupportError("nameLimit");
    changes[fieldKey("team", command.teamId, "name")] = name;
    observeTeam(command.teamId);
  } else {
    assertMaintenance(board);
    assertMovable(board, roster, command.memberId);
    assertTeam(board, command.from);
    assertTeam(board, command.to);
    if (command.from === command.to || memberTeam(board, command.memberId) !== command.from) throw new SupportError("changed");
    const affectedTeams = [command.from, command.to].filter((id): id is string => id !== null);
    if (!actor.override && affectedTeams.some((id) => !ownTeam(board, roster, actor, id))) throw new SupportError("forbidden");
    affectedTeams.forEach(observeTeam);
    changes[fieldKey("member", command.memberId, "team")] = command.to;
    if (command.kind === "swap") {
      assertMovable(board, roster, command.otherMemberId);
      if (command.memberId === command.otherMemberId || memberTeam(board, command.otherMemberId) !== command.to) throw new SupportError("changed");
      changes[fieldKey("member", command.otherMemberId, "team")] = command.from;
    } else if (command.to) {
      const target = balancedTargets(roster.length, teamIds(board))[command.to];
      const size = roster.filter((m) => memberTeam(board, m.id) === command.to).length;
      if (size >= target) throw new SupportError("teamFull");
    }
  }
  return { changes, reads: [...reads] };
}
export function decideCommand(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, command: SupportCommand): SupportErrorCode | null {
  try { commandChanges(board, roster, actor, command); return null; }
  catch (error) { if (error instanceof SupportError) return error.code; throw error; }
}
export function recordChanges(board: SupportBoard, actor: SupportActor, changes: Record<string, SupportValue>, observed: string[], context: SupportContext, kind: SupportEvent["kind"], identity: EventIdentity, reverses: string[] = []) {
  if (context.mode === "undo" && Object.keys(changes).some((key) => JSON.parse(key)[0] === "membership")) throw new SupportError("dependencies");
  const next: SupportBoard = { ...board, version: board.version + 1, fields: { ...board.fields } };
  const keys = [...new Set([...Object.keys(changes), ...observed])].sort();
  const observedVersions = Object.fromEntries(keys.map((key) => [key, fieldVersion(board, key)]));
  const dependsOn = [...new Set(keys.flatMap((key) => board.fields[key]?.actionId ? [board.fields[key].actionId!] : []))].sort();
  const patches = Object.entries(changes).map(([key, after]) => {
    const beforeVersion = fieldVersion(board, key);
    const patch = { key, before: readField(board, key), after, beforeVersion, afterVersion: beforeVersion + 1 };
    next.fields[key] = { value: after, version: patch.afterVersion, actionId: identity.id };
    return patch;
  });
  const resources = keys.map((key) => JSON.parse(key) as string[]);
  const event: SupportEvent = { ...identity, allianceId: board.allianceId, principalId: actor.principalId, actorName: actor.displayName ?? null, memberNames: {}, teamNames: Object.fromEntries(resources.filter(([r]) => r === "team").map(([, id]) => [id, readField(board, fieldKey("team", id, "name")) as string | null])), kind, context, boardVersion: next.version, patches, observedVersions, dependsOn, reverses, teamIds: [...new Set(resources.filter(([r]) => r === "team").map(([, id]) => id))], memberIds: [...new Set(resources.filter(([r]) => r === "member" || r === "membership").map(([, id]) => id))] };
  return { board: next, event };
}
export function applyCommand(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, command: SupportCommand, identity: EventIdentity) {
  const { changes, reads } = commandChanges(board, roster, actor, command);
  return recordChanges(board, actor, changes, reads, { mode: command.kind === "createTeam" && !board.published ? "setup" : "maintenance" }, command.kind, identity);
}

export function validateRestoration(board: SupportBoard, roster: SupportRosterMember[], changedKeys: string[]) {
  const teams = teamIds(board);
  const leads = teams.map((id) => teamLead(board, id)).filter((id) => id !== null);
  if (new Set(leads).size !== leads.length) throw new SupportError("invalid");
  for (const key of changedKeys) {
    const [resource, id, name] = JSON.parse(key) as string[];
    const value = readField(board, key);
    if (resource === "member" && name === "team" && value !== null) {
      if (!roster.some((m) => m.id === id) || !teams.includes(String(value))) throw new SupportError("invalid");
      const stint = board.fields[fieldKey("membership", id, "stint")];
      if (stint && (!stint.value || readField(board, fieldKey("member", id, "assignmentStint")) !== stint.value)) throw new SupportError("memberUnavailable");
    }
    if (resource === "team" && name === "lead" && value !== null && !eligible(roster, String(value))) throw new SupportError("invalid");
  }
  for (const team of teams) {
    const lead = teamLead(board, team);
    if (lead !== null && memberTeam(board, lead) !== team) throw new SupportError("invalid");
  }
}
