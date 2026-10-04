import { assertWriter, balancedTargets, fieldKey, fieldVersion, memberTeam, recordChanges, teamIds, validateRestoration } from "./policy.shared";
import { SupportError, type EventIdentity, type SupportActor, type SupportBoard, type SupportEvent, type SupportRosterMember, type SupportValue, type UndoPreview } from "./types.shared";

import { draftKey, validateDraftRestoration } from "./draft.shared";
import { readField } from "./policy.shared";
import { validateProposalRestoration } from "./proposal.shared";

export function activeReversals(history: SupportEvent[]): Map<string, string> {
  const reversed = new Map<string, string>();
  for (const event of [...history].sort((a, b) => b.boardVersion - a.boardVersion)) {
    if (!reversed.has(event.id)) for (const id of event.reverses) if (!reversed.has(id)) reversed.set(id, event.id);
  }
  return reversed;
}

export function previewUndo(board: SupportBoard, history: SupportEvent[], roster: SupportRosterMember[], actor: SupportActor, rootActionId: string, now = Date.now()): UndoPreview {
  assertWriter(board, actor);
  const events = history.filter((event) => event.allianceId === board.allianceId).sort((a, b) => a.boardVersion - b.boardVersion);
  const root = events.find((event) => event.id === rootActionId);
  if (!root || (!actor.override && root.principalId !== actor.principalId)) throw new SupportError("forbidden");
  const reversed = activeReversals(events);
  if (reversed.has(rootActionId)) throw new SupportError("undone");
  if (root.kind === "undo" && !actor.override) {
    const affected = new Set(root.reverses);
    for (const event of [...events].reverse()) {
      if (!affected.has(event.id)) continue;
      if (event.principalId !== actor.principalId && event.principalType !== "service" && event.actorType !== "service") throw new SupportError("forbidden");
      event.reverses.forEach((id) => affected.add(id));
    }
  }
  const draftId = root.context.draftId;
  if (draftId && board.construction?.id === draftId && now >= Date.parse(String(readField(board, draftKey(draftId, "endsAt"))))) throw new SupportError("notOpen");
  const active = events.filter((event) => (event.kind !== "undo" || (root.kind === "undo" && event.boardVersion >= root.boardVersion)) && !reversed.has(event.id));
  const activeIds = new Set(active.map((event) => event.id));
  const writers = new Map<string, string>();
  const dependencies = new Map<string, Set<string>>();
  for (const event of active) {
    const parents = new Set(event.dependsOn.filter((id) => activeIds.has(id)));
    for (const key of Object.keys(event.observedVersions)) {
      const writer = writers.get(key);
      if (writer) parents.add(writer);
    }
    dependencies.set(event.id, parents);
    event.patches.forEach((patch) => writers.set(patch.key, event.id));
  }
  const physicalVersions = new Map<string, number>();
  events.forEach((event) => event.patches.forEach((patch) => physicalVersions.set(patch.key, patch.afterVersion)));
  const closure = new Set([rootActionId]);
  for (let attempt = 0; attempt <= active.length; attempt++) {
    for (const event of active) {
      if ([...dependencies.get(event.id)!].some((id) => closure.has(id))) closure.add(event.id);
    }
    const actions = active.filter((event) => closure.has(event.id)).reverse();
    const changes: Record<string, SupportValue> = {};
    const observed = new Set<string>();
    for (const event of actions) {
      Object.keys(event.observedVersions).forEach((key) => observed.add(key));
      for (const patch of event.patches) {
        observed.add(patch.key);
        if (physicalVersions.get(patch.key) !== fieldVersion(board, patch.key)) throw new SupportError("dependencies");
        changes[patch.key] = patch.before;
      }
    }
    const simulated = recordChanges(board, actor, changes, [...observed], { mode: "undo", sourceActionId: rootActionId, draftId: root.context.draftId, proposalId: root.context.proposalId }, "undo", { id: "preview", at: "", idempotencyKey: "" }, actions.map((event) => event.id));
    const targets = balancedTargets(roster.length, teamIds(simulated.board));
    const overfull = Object.keys(targets).find((team) => {
      const before = roster.filter((member) => memberTeam(board, member.id) === team).length;
      const after = roster.filter((member) => memberTeam(simulated.board, member.id) === team).length;
      return after > targets[team] && after > before;
    });
    if (overfull) {
      const arrival = [...active].reverse().find((event) => !closure.has(event.id) && event.boardVersion > root.boardVersion && event.patches.some((patch) => patch.after === overfull && patch.before !== overfull && writers.get(patch.key) === event.id && JSON.parse(patch.key)[0] === "member"));
      if (!arrival) throw new SupportError("invalid");
      closure.add(arrival.id);
      continue;
    }
    if (actions.length > 1 && !actor.override) throw new SupportError("dependencies");
    validateRestoration(simulated.board, roster, Object.keys(changes));
    validateDraftRestoration(simulated.board, roster, Object.keys(changes), now);
    validateProposalRestoration(simulated.board, roster, Object.keys(changes));
    const restoredTeams = new Set(Object.entries(changes).filter(([key, value]) => JSON.parse(key)[0] === "member" && typeof value === "string").map(([, value]) => String(value)));
    for (const member of roster) {
      if (restoredTeams.has(memberTeam(board, member.id) ?? "")) observed.add(fieldKey("member", member.id, "team"));
    }
    return { rootActionId, actionIds: actions.map((event) => event.id), expectedVersions: Object.fromEntries([...observed].sort().map((key) => [key, fieldVersion(board, key)])), patches: simulated.event.patches };
  }
  throw new SupportError("invalid");
}

export function confirmUndo(board: SupportBoard, history: SupportEvent[], roster: SupportRosterMember[], actor: SupportActor, expected: UndoPreview, identity: EventIdentity) {
  const preview = previewUndo(board, history, roster, actor, expected.rootActionId, Number.isFinite(Date.parse(identity.at)) ? Date.parse(identity.at) : Date.now());
  const sameVersions = Object.keys(preview.expectedVersions).length === Object.keys(expected.expectedVersions).length && Object.entries(preview.expectedVersions).every(([key, value]) => expected.expectedVersions[key] === value);
  if (!sameVersions || JSON.stringify(preview.actionIds) !== JSON.stringify(expected.actionIds)) throw new SupportError("changed");
  return recordChanges(board, actor, Object.fromEntries(preview.patches.map((patch) => [patch.key, patch.after])), Object.keys(preview.expectedVersions), { mode: "undo", sourceActionId: preview.rootActionId, draftId: history.find((event) => event.id === preview.rootActionId)?.context.draftId, proposalId: history.find((event) => event.id === preview.rootActionId)?.context.proposalId }, "undo", identity, preview.actionIds);
}

export function historyPage(events: SupportEvent[], input: { beforeVersion?: number; actorId?: string; teamId?: string; memberId?: string; kind?: string; contextId?: string; query?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(50, input.limit ?? 25));
  const query = input.query?.trim().toLocaleLowerCase();
  const matching = events.filter((event) =>
    (!input.beforeVersion || event.boardVersion < input.beforeVersion) &&
    (!input.actorId || event.principalId === input.actorId) &&
    (!input.teamId || event.teamIds.includes(input.teamId)) &&
    (!input.memberId || event.memberIds.includes(input.memberId)) &&
    (!input.kind || event.kind === input.kind) &&
    (!input.contextId || event.context.draftId === input.contextId || event.context.proposalId === input.contextId) &&
    (!query || [event.principalId, event.actorName ?? "", event.kind, ...Object.values(event.memberNames), ...Object.values(event.teamNames).map((name) => name ?? ""), ...event.teamIds, ...event.memberIds, ...event.patches.flatMap((patch) => [String(patch.before ?? ""), String(patch.after ?? "")])].some((value) => value.toLocaleLowerCase().includes(query))),
  ).sort((a, b) => b.boardVersion - a.boardVersion);
  const page = matching.slice(0, limit);
  return { events: page, nextBeforeVersion: matching.length > limit ? page.at(-1)!.boardVersion : null };
}
