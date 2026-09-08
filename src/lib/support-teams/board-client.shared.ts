import type { SupportCommand, SupportSnapshot, SupportErrorCode } from "./types.shared";
import { decideCommand } from "./policy.shared";
import { normalizeCountry } from "./display-preferences.shared";

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
