import "server-only";

import { applyCommand, fieldKey, memberTeam, readField, recordChanges, teamIds, teamLead } from "./policy.shared";
import { SupportError, type EventIdentity, type SupportActor, type SupportBoard, type SupportCommand, type SupportEvent, type SupportRosterMember, type SupportValue, type UndoPreview } from "./types.shared";

export const SUPPORT_MEMBERSHIP_SERVICE = "service:support-team-membership";
export const privateSupportKey = (key: string) => {
  const [resource, , field] = JSON.parse(key) as string[];
  return resource === "membership" || field === "assignmentStint" || field === "workspaceStintToken" || (resource.startsWith("draftMember:") && field === "stint") || (resource === "draft" && field === "rosterFingerprint");
};
export const publicVersions = (versions: Record<string, number>) => Object.fromEntries(Object.entries(versions).filter(([key]) => !privateSupportKey(key)));
export const publicBoard = (board: SupportBoard): SupportBoard => ({ ...board, fields: Object.fromEntries(Object.entries(board.fields).filter(([key]) => !privateSupportKey(key))) });
export const publicEvent = (event: SupportEvent): SupportEvent => ({ ...event, patches: event.patches.filter((patch) => !privateSupportKey(patch.key)), observedVersions: publicVersions(event.observedVersions) });
export const publicUndoPreview = (preview: UndoPreview): UndoPreview => ({ ...preview, patches: preview.patches.filter((patch) => !privateSupportKey(patch.key)), expectedVersions: publicVersions(preview.expectedVersions) });

export function membershipChanges(board: SupportBoard, roster: SupportRosterMember[], stints: Record<string, string>) {
  const changes: Record<string, SupportValue> = {};
  const members = new Map(roster.map((member) => [member.id, member]));
  const ids = new Set([...members.keys(), ...Object.keys(board.fields).flatMap((key) => {
    const [resource, id] = JSON.parse(key) as string[];
    return resource === "member" || resource === "membership" ? [id] : [];
  })]);
  for (const id of ids) {
    const stint = members.has(id) ? stints[id] ?? null : null;
    const key = fieldKey("membership", id, "stint");
    if (!board.fields[key] || readField(board, key) !== stint) changes[key] = stint;
    if (memberTeam(board, id) !== null && (!stint || readField(board, fieldKey("member", id, "assignmentStint")) !== stint)) {
      changes[fieldKey("member", id, "team")] = null;
      changes[fieldKey("member", id, "assignmentStint")] = null;
      changes[key] = stint;
    }
  }
  for (const team of teamIds(board)) {
    const lead = teamLead(board, team);
    if (lead === null) continue;
    const member = members.get(lead);
    if (!member || (member.rank !== 4 && member.rank !== 5) || !stints[lead] || readField(board, fieldKey("member", lead, "assignmentStint")) !== stints[lead]) {
      changes[fieldKey("team", team, "lead")] = null;
      changes[fieldKey("membership", lead, "leadEligibility")] = null;
    }
  }
  return changes;
}

export function projectMemberships(board: SupportBoard, roster: SupportRosterMember[], stints: Record<string, string>): SupportBoard {
  const fields = { ...board.fields };
  for (const [key, value] of Object.entries(membershipChanges(board, roster, stints))) {
    fields[key] = { value, version: board.fields[key]?.version ?? 0, actionId: board.fields[key]?.actionId ?? null };
  }
  return { ...board, fields };
}

export function reconcileMemberships(board: SupportBoard, roster: SupportRosterMember[], stints: Record<string, string>, identity: EventIdentity) {
  const changes = membershipChanges(board, roster, stints);
  if (!Object.keys(changes).length) return null;
  const actor: SupportActor = { allianceId: board.allianceId, principalId: SUPPORT_MEMBERSHIP_SERVICE, canRead: false, canWrite: false, override: false, linkedMemberIds: [] };
  const observed = Object.keys(changes).flatMap((key) => {
    const [resource, , field] = JSON.parse(key) as string[];
    const team = readField(board, key);
    return resource === "member" && field === "team" && typeof team === "string" ? [fieldKey("team", team, "exists")] : [];
  });
  const result = recordChanges(board, actor, changes, observed, { mode: "maintenance" }, "reconcile", identity);
  result.event.actorType = "service";
  result.event.principalType = "service";
  result.event.memberNames = Object.fromEntries(roster.filter((member) => result.event.memberIds.includes(member.id)).map((member) => [member.id, member.name]));
  return result;
}

export function applyStintCommand(board: SupportBoard, roster: SupportRosterMember[], actor: SupportActor, command: SupportCommand, identity: EventIdentity) {
  return bindStintAssignments(board, actor, applyCommand(board, roster, actor, command, identity));
}

export function bindStintAssignments(board: SupportBoard, actor: SupportActor, result: { board: SupportBoard; event: SupportEvent }) {
  const changes = Object.fromEntries(result.event.patches.map((patch) => [patch.key, patch.after]));
  const reads = Object.keys(result.event.observedVersions);
  for (const patch of result.event.patches) {
    const [resource, id, field] = JSON.parse(patch.key) as string[];
    if (resource === "member" && field === "team") {
      const stintKey = fieldKey("membership", id, "stint");
      const stint = readField(board, stintKey);
      if (patch.after !== null && !stint) throw new SupportError("memberUnavailable");
      reads.push(stintKey);
      changes[fieldKey("member", id, "assignmentStint")] = patch.after === null ? null : stint;
    }
    if (resource === "team" && field === "lead" && typeof patch.after === "string") {
      reads.push(fieldKey("membership", patch.after, "leadEligibility"));
    }
  }
  const bound = recordChanges(board, actor, changes, reads, result.event.context, result.event.kind, result.event, result.event.reverses);
  return { board: bound.board, event: { ...result.event, patches: bound.event.patches, observedVersions: bound.event.observedVersions, dependsOn: bound.event.dependsOn } };
}

export function assertMembershipUndo(preview: UndoPreview, events: SupportEvent[]) {
  if (events.some((event) => preview.actionIds.includes(event.id) && (event.kind === "reconcile" || event.principalId === SUPPORT_MEMBERSHIP_SERVICE))) throw new SupportError("dependencies");
}
