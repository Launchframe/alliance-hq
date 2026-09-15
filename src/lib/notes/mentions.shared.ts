import type { PerformanceNoteRosterMember } from "@/lib/performance-notes/types.shared";

export type NoteMention = {
  start: number;
  end: number;
  text: string;
  automatic: boolean;
  candidates: PerformanceNoteRosterMember[];
};

const ambiguousWords = new Set(["will", "may", "can", "me", "you", "the", "and", "or", "no", "yes", "eu", "ele", "ela", "com", "sem", "um", "uma", "para", "sim", "não"]);
const fold = (value: string) => value.normalize("NFKC").toLowerCase();
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function detectNoteMentions(body: string, roster: readonly PerformanceNoteRosterMember[]): { memberIds: string[]; matches: NoteMention[] } {
  const masked = body.replace(/```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s)]+|[^\s@]+@[^\s@]+\.[^\s@]+/giu, (value) => " ".repeat(value.length));
  let normalized = "";
  const positions: Array<{ start: number; end: number }> = [];
  for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(masked)) {
    const value = fold(part.segment);
    normalized += value;
    for (let i = 0; i < value.length; i++) positions.push({ start: part.index, end: part.index + part.segment.length });
  }
  const names = new Map<string, Map<string, PerformanceNoteRosterMember>>();
  for (const member of roster) {
    for (const alias of [member.name, ...(member.previousNames ?? [])]) {
      const name = fold(alias.trim()).replace(/\s+/g, " ");
      if (!name) continue;
      const candidates = names.get(name) ?? new Map<string, PerformanceNoteRosterMember>();
      candidates.set(member.ashedMemberId, member);
      names.set(name, candidates);
    }
  }
  const possible: NoteMention[] = [];
  for (const [name, members] of names) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${name.split(" ").map(escapePattern).join("\\s+")}(?![\\p{L}\\p{N}_])`, "gu");
    for (const match of normalized.matchAll(pattern)) {
      const index = match.index;
      const start = positions[index]?.start;
      const end = positions[index + match[0].length - 1]?.end;
      if (start === undefined || end === undefined) continue;
      const explicit = normalized[index - 1] === "@";
      possible.push({
        start, end, text: body.slice(start, end), candidates: [...members.values()],
        automatic: members.size === 1 && (explicit || name.replace(/\s/g, "").length >= 3 && !ambiguousWords.has(name)),
      });
    }
  }
  const matches: NoteMention[] = [];
  for (const match of possible.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (!matches.some((other) => match.start < other.end && other.start < match.end)) matches.push(match);
  }
  matches.sort((a, b) => a.start - b.start);
  return { memberIds: [...new Set(matches.filter((match) => match.automatic).map((match) => match.candidates[0].ashedMemberId))], matches };
}
