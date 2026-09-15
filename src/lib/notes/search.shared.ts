import { z } from "zod";

export const noteSearchSchema = z.object({
  q: z.string().trim().min(1).max(200), kind: z.enum(["all", "note", "task", "source"]).default("all"),
  offset: z.coerce.number().int().min(0).max(5_000).default(0), limit: z.coerce.number().int().min(1).max(25).default(25),
});
export type NoteSearchInput = z.infer<typeof noteSearchSchema>;
export type NoteSearchResult = { id: string; kind: "note" | "task" | "source"; title: string; excerpt: string; href: string | null; sourceDate: string | null };
export type NoteSearchResponse = { results: NoteSearchResult[]; nextOffset: number | null };

/** True when redaction left only secret/UID placeholders — do not search those tokens. */
export function isPlaceholderOnlySearchQuery(query: string): boolean {
  return !query
    .replace(/\[redacted-(?:id|jwt)\]/gi, " ")
    .replace(/\bBearer \[redacted\]/gi, " ")
    .replace(/\b(?:token|api[_-]?key|password|secret|authorization|cookie|set-cookie|x-api-key)=\[redacted\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
