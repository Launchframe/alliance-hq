export type NoteSuggestionEvent = {
  notes: string | null;
  updatedAt: string;
};

export function extractHistoricalNotes(
  events: readonly NoteSuggestionEvent[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const sorted = [...events].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  for (const event of sorted) {
    const note = event.notes?.trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(note);
  }

  return result;
}

export function filterNoteSuggestions(
  notes: readonly string[],
  query: string,
  limit = 8,
): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return notes.slice(0, limit);
  }

  const needle = trimmed.toLowerCase();
  return notes.filter((note) => note.toLowerCase().includes(needle)).slice(0, limit);
}
