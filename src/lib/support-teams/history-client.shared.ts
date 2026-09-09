import type { SupportEvent, SupportPatch, SupportSnapshot, SupportValue, UndoPreview } from "./types.shared";

export type HistoryRow = SupportEvent & { undoBlocked: string | null; reversalId: string | null };
export type HistoryResult = { events: HistoryRow[]; nextBeforeVersion: number | null };
export const historyKindLabels = { createTeam: "supportTeams.addLead", replaceLead: "supportTeams.replaceLead", rename: "supportTeams.rename", move: "supportTeams.moveMember", swap: "supportTeams.swapMembers", undo: "supportTeams.history.undo", reconcile: "supportTeams.saved", scheduleDraft: "supportTeams.draft.create", draftPick: "supportTeams.draft.pick", advanceDraft: "supportTeams.draft.title", extendDraft: "supportTeams.draft.extend", publishDraft: "supportTeams.draft.publish", cancelDraft: "timeOff.officerModal.cancel" } as const satisfies Record<SupportEvent["kind"], string>;
export function historyServiceLabel(event: SupportEvent) {
  return event.actorType === "service" || event.principalType === "service" || event.principalId.startsWith("service:") ? event.context.mode === "draft" ? "supportTeams.draft.title" : "supportTeams.title" : null;
}
export function undoConfirmation(preview: UndoPreview, idempotencyKey: string) {
  return { actionIds: preview.actionIds, expectedVersions: preview.expectedVersions, idempotencyKey };
}
export function historyNames(snapshot: SupportSnapshot, event: Pick<SupportEvent, "memberNames" | "teamNames">, fallbackTeam: (number: number) => string, unknown: string, unsorted: string) {
  const member = (id: string) => event.memberNames[id] ?? snapshot.roster.find((row) => row.id === id)?.name ?? unknown;
  const team = (id: string | null) => {
    if (!id) return unsorted;
    const index = snapshot.teams.findIndex((row) => row.id === id);
    return event.teamNames[id] ?? snapshot.teams[index]?.name ?? (index >= 0 ? fallbackTeam(index + 1) : unknown);
  };
  return { member, team };
}
export function humanizePatch(patch: SupportPatch, names: ReturnType<typeof historyNames>, labels: { teamName: string; lead: string; member: string; unknown: string; yes: string; no: string }, locale: string) {
  let resource: string, id: string, field: string;
  try { [resource, id, field] = JSON.parse(patch.key) as string[]; } catch { return { label: labels.unknown, before: labels.unknown, after: labels.unknown }; }
  const format = (value: SupportValue) => {
    if (field === "team") return names.team(value === null ? null : String(value));
    if (field === "lead") return value === null ? labels.unknown : names.member(String(value));
    if (field === "name") return typeof value === "string" ? value : labels.unknown;
    if (typeof value === "number") return value.toLocaleString(locale);
    if (typeof value === "boolean") return value ? labels.yes : labels.no;
    return labels.unknown;
  };
  const label = resource === "member" || resource.startsWith("draftMember:") ? names.member(id) : resource === "team" || resource.startsWith("draftTeam:") ? `${names.team(id)} · ${field === "lead" ? labels.lead : labels.teamName}` : labels.unknown;
  return { label, before: format(patch.before), after: format(patch.after) };
}
