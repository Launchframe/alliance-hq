import type { ReleaseNoteEntry } from "./types";
import { compareAppVersions } from "./version";
import { hydrateReleaseNoteEntry } from "./markdown";
import type { ReleaseNoteEdgeEntry } from "./markdown";

export function validateReleaseNoteEntries(value: unknown): ReleaseNoteEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: ReleaseNoteEntry[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const version = String(record.version ?? "").trim();
    const title = String(record.title ?? "").trim();
    const summary = String(record.summary ?? "");

    if (!version || !title) {
      continue;
    }

    const edgeEntry: ReleaseNoteEdgeEntry | ReleaseNoteEntry = {
      version,
      title,
      summary,
      ...(record.shippedAt ? { shippedAt: String(record.shippedAt) } : {}),
      ...(Array.isArray(record.breaking)
        ? { breaking: record.breaking.map(String) }
        : {}),
      ...(Array.isArray(record.maintainerNotes)
        ? { maintainerNotes: record.maintainerNotes.map(String) }
        : {}),
      ...(typeof record.bodyMarkdown === "string" && record.bodyMarkdown
        ? { bodyMarkdown: record.bodyMarkdown }
        : {}),
    };

    entries.push(hydrateReleaseNoteEntry(edgeEntry));
  }

  return entries.sort((a, b) => compareAppVersions(a.version, b.version));
}
