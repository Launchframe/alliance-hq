import type { TimeOffDraft } from "./workflow.shared";

export type TimeOffDiscordState =
  | { kind: "members"; memberIds: string[]; command: string; options: Record<string, string>; page: number }
  | { kind: "list"; entryIds: string[]; memberId?: string; page: number; history: boolean; rangeStart?: string; rangeEnd?: string; unexpected?: boolean }
  | { kind: "member"; memberId: string; entryKind: TimeOffDraft["entryKind"]; requestId?: string }
  | { kind: "entry"; entryId: string; version: number; requestId?: string }
  | { kind: "draft"; draft: TimeOffDraft; requestId: string; entryId?: string; version?: number }
  | { kind: "cancel"; entryId: string; version: number };

export function parseTimeOffCustomId(value: unknown): { token: string; action: string } | null {
  if (typeof value !== "string") return null;
  const match = /^timeoff:([A-Za-z0-9_-]{21}):([a-z0-9-]{1,24})$/.exec(value);
  return match ? { token: match[1], action: match[2] } : null;
}

export function timeOffCustomId(token: string, action: string) {
  const value = `timeoff:${token}:${action}`;
  if (!parseTimeOffCustomId(value)) throw new Error("invalid_time_off_component");
  return value;
}

export function timeOffComponentNeedsModal(value: unknown) {
  const parsed = parseTimeOffCustomId(value);
  return parsed?.action === "new" || parsed?.action === "edit";
}

export function escapeTimeOffDiscordText(value: string) {
  return value.replace(/([\\`*_~>|])/g, "\\$1").replace(/@/g, "@\u200b");
}
