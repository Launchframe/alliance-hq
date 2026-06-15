import type { ReleaseNoteEntry } from "./types";
import { compareAppVersions } from "./version";

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
    const bodyMarkdown = String(record.bodyMarkdown ?? summary);

    if (!version || !title) {
      continue;
    }

    entries.push({
      version,
      title,
      summary,
      bodyMarkdown,
      ...(record.shippedAt ? { shippedAt: String(record.shippedAt) } : {}),
      ...(Array.isArray(record.breaking)
        ? { breaking: record.breaking.map(String) }
        : {}),
      ...(Array.isArray(record.maintainerNotes)
        ? { maintainerNotes: record.maintainerNotes.map(String) }
        : {}),
    });
  }

  return entries.sort((a, b) => compareAppVersions(a.version, b.version));
}
