import type { SupportCommand, SupportSnapshot, SupportErrorCode } from "./types.shared";
import { decideCommand } from "./policy.shared";
import { normalizeCountry } from "./display-preferences.shared";
import type { DraftSnapshot } from "./draft.shared";
import type { ProposalSnapshot } from "./proposal.shared";

export function workingProposalSnapshot(proposal: ProposalSnapshot, linkedMemberIds: string[]): SupportSnapshot {
  return { version: proposal.version, published: false, teams: proposal.teams.map((team) => ({ ...team, memberIds: [...team.memberIds], needsReplacement: false })), roster: proposal.roster, linkedMemberIds, canWrite: proposal.canEdit };
}
export function proposalWorkspaceKey(live: SupportSnapshot, id: string | null): string | null {
  return id && live.actor?.canRead && live.board && live.actor.allianceId === live.board.allianceId ? JSON.stringify([live.board.allianceId, live.actor.principalId, id]) : null;
}
export function acceptsProposalSnapshot(proposal: ProposalSnapshot, live: SupportSnapshot, id: string, key: string) {
  return key === proposalWorkspaceKey(live, id) && proposal.id === id && proposal.version >= live.version;
}
export function proposalBoardInteractions(adapter: { move: (id: string, to: string | null) => Promise<boolean>; swap: (id: string, other: string) => Promise<boolean>; canMoveMember: (id: string, to: string | null) => boolean; canSwapMembers: (id: string, other: string) => boolean }, published: SupportSnapshot, execute: (command: SupportCommand, slot: string) => void) {
  const eligibility = (id: string, to: string | null, other?: string): string | null => (other ? adapter.canSwapMembers(id, other) : adapter.canMoveMember(id, to)) ? null : "changed";
  const canCommand = (command: SupportCommand) => command.kind === "rename" && published.teams.some((team) => team.id === command.teamId) && commandEligibility(published, { ...command, expectedVersion: published.version }) === null;
  return {
    eligibility,
    onMove: (id: string, to: string | null, other?: string) => { if (!eligibility(id, to, other)) { if (other) void adapter.swap(id, other); else void adapter.move(id, to); } },
    canCommand,
    onCommand: (command: SupportCommand, slot: string) => { if (canCommand(command)) execute({ ...command, expectedVersion: published.version }, slot); },
  };
}

export function workingDraftSnapshot(draft: DraftSnapshot): SupportSnapshot {
  return { version: draft.version, published: false, teams: draft.teams.map((team) => ({ id: team.id, name: team.name, leadId: team.leadId, target: team.target, memberIds: [...team.memberIds], needsReplacement: false })), roster: draft.roster, linkedMemberIds: draft.actor.linkedMemberIds, canWrite: draft.actor.canWrite };
}
export function currentDraftPhase(draft: DraftSnapshot, now: number) {
  if (draft.phase === "published" || draft.phase === "canceled") return draft.phase;
  if (now >= Date.parse(draft.config.endsAt)) return "expired";
  if (now < Date.parse(draft.config.startsAt)) return "scheduled";
  return draft.phase === "scheduled" ? "open" : draft.phase;
}
export function canPickDraftMember(draft: DraftSnapshot, teamId: string, memberId: string, now: number, pending: string[]) {
  const team = draft.teams.find((item) => item.id === teamId);
  const member = draft.roster.find((item) => item.id === memberId);
  return Boolean(draft.actor.canWrite && draft.rosterValid && currentDraftPhase(draft, now) === "open" && team && !team.picked && team.applicable && member && member.rank !== 4 && member.rank !== 5 && draft.memberLocations[memberId] === null && (!team.proxy || draft.actor.canManage || now >= Date.parse(draft.deadline)) && !pending.includes(teamId));
}
export function draftWorkspaceKey(snapshot: SupportSnapshot): string | null {
  const board = snapshot.board;
  return snapshot.actor?.canRead && board && snapshot.actor.allianceId === board.allianceId && board.construction?.kind === "draft" ? JSON.stringify([board.allianceId, board.construction.id, snapshot.actor.principalId]) : null;
}
export function acceptsDraftSnapshot(draft: DraftSnapshot, live: SupportSnapshot, key: string) {
  return key === draftWorkspaceKey(live) && draft.id === live.board?.construction?.id && draft.version >= live.version && draft.phase !== "published" && draft.phase !== "canceled";
}
export function draftBoardInteractions(adapter: { pick: (teamId: string, memberId: string) => Promise<boolean>; canPickMember: (teamId: string, memberId: string) => boolean }, published: SupportSnapshot, execute: (command: SupportCommand, slot: string) => void) {
  const eligibility = (memberId: string, to: string | null, otherMemberId?: string): string | null => !to || otherMemberId ? "forbidden" : adapter.canPickMember(to, memberId) ? null : "notOpen";
  const canCommand = (command: SupportCommand) => command.kind === "rename" && published.teams.some((team) => team.id === command.teamId) && commandEligibility(published, { ...command, expectedVersion: published.version }) === null;
  return {
    eligibility,
    onMove: (memberId: string, to: string | null, otherMemberId?: string) => { if (to && !eligibility(memberId, to, otherMemberId)) void adapter.pick(to, memberId); },
    canCommand,
    onCommand: (command: SupportCommand, slot: string) => { if (canCommand(command)) execute({ ...command, expectedVersion: published.version }, slot); },
  };
}

export const chipMetrics = ["professionLevel", "baseLevel", "thp", "tenureDays"] as const;
export const metricLabels = { professionLevel: "profession", baseLevel: "baseLevel", thp: "thp", tenureDays: "tenure" } as const;
export function locationOf(snapshot: SupportSnapshot, memberId: string): string | null {
  return snapshot.teams.find((team) => team.memberIds.includes(memberId))?.id ?? null;
}
export function ownTeamId(snapshot: SupportSnapshot): string | null {
  return snapshot.teams.find((team) => team.leadId && snapshot.linkedMemberIds.includes(team.leadId))?.id
    ?? snapshot.teams.find((team) => team.memberIds.some((id) => snapshot.linkedMemberIds.includes(id)))?.id ?? null;
}
export function moveCommand(snapshot: SupportSnapshot, memberId: string, to: string | null): SupportCommand {
  return { kind: "move", memberId, from: locationOf(snapshot, memberId), to, expectedVersion: snapshot.version };
}
export function commandEligibility(snapshot: SupportSnapshot, command: SupportCommand): SupportErrorCode | null {
  if (!snapshot.board || !snapshot.actor) return "forbidden";
  return decideCommand(snapshot.board, snapshot.roster, snapshot.actor, command);
}
export function acceptSnapshot(current: SupportSnapshot, incoming: SupportSnapshot): SupportSnapshot {
  if (current.board && incoming.board && current.board.allianceId !== incoming.board.allianceId) return current;
  return incoming.version >= current.version ? incoming : current;
}
export function swipeDirection(dx: number, dy: number, interactive: boolean, selectedText: boolean): -1 | 0 | 1 {
  if (interactive || selectedText || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? 1 : -1;
}
export function countryPresentation(country: string | null, locale: string, unknown: string) {
  const code = normalizeCountry(country);
  return code ? { flag: String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0))), label: new Intl.DisplayNames(locale, { type: "region" }).of(code) ?? unknown } : { flag: "—", label: unknown };
}
export function supportErrorKey(code: string | undefined, history = false) {
  if (code === "forbidden") return "readOnly";
  if (code === "notOpen") return "draft.notOpen";
  if (code === "dependencies" || code === "invalid" || code === "undone") return `history.${code}` as const;
  if (code === "memberUnavailable" || code === "leadRequired" || code === "teamFull" || code === "nameRequired" || code === "nameLimit") return code;
  return history ? "history.changed" : "changed";
}
export class SupportClientError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export async function supportRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new SupportClientError(body?.code ?? "changed", response.status);
  return body as T;
}
