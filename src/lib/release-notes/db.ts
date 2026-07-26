import { getDb, schema } from "@/lib/db";
import type { HqReleaseNote } from "@/lib/db/schema";

import type { ReleaseNoteEntry } from "./types";
import { compareAppVersions } from "./version";

export type HqReleaseNoteRow = {
  version: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  breaking: string[] | null;
  maintainerNotes: string[] | null;
  shippedAt: Date | null;
  updatedAt: Date;
};

export function entryToRow(entry: ReleaseNoteEntry): Omit<
  HqReleaseNoteRow,
  "updatedAt"
> {
  return {
    version: entry.version,
    title: entry.title,
    summary: entry.summary,
    bodyMarkdown: entry.bodyMarkdown,
    breaking:
      entry.breaking && entry.breaking.length > 0 ? entry.breaking : null,
    maintainerNotes:
      entry.maintainerNotes && entry.maintainerNotes.length > 0
        ? entry.maintainerNotes
        : null,
    shippedAt: entry.shippedAt ? new Date(entry.shippedAt) : null,
  };
}

export function rowToEntry(row: HqReleaseNote | HqReleaseNoteRow): ReleaseNoteEntry {
  return {
    version: row.version,
    title: row.title,
    summary: row.summary,
    bodyMarkdown: row.bodyMarkdown,
    ...(row.shippedAt
      ? {
          shippedAt:
            row.shippedAt instanceof Date
              ? row.shippedAt.toISOString()
              : String(row.shippedAt),
        }
      : {}),
    ...(row.breaking && row.breaking.length > 0
      ? { breaking: row.breaking }
      : {}),
    ...(row.maintainerNotes && row.maintainerNotes.length > 0
      ? { maintainerNotes: row.maintainerNotes }
      : {}),
  };
}

export async function loadReleaseNotesFromDatabase(): Promise<
  ReleaseNoteEntry[]
> {
  try {
    const db = getDb();
    const rows = await db.select().from(schema.hqReleaseNotes);
    return rows
      .map(rowToEntry)
      .sort((a, b) => compareAppVersions(a.version, b.version));
  } catch {
    return [];
  }
}

export async function upsertReleaseNoteEntries(
  entries: ReleaseNoteEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const db = getDb();
  const now = new Date();

  for (const entry of entries) {
    const row = entryToRow(entry);
    await db
      .insert(schema.hqReleaseNotes)
      .values({
        ...row,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.hqReleaseNotes.version,
        set: {
          title: row.title,
          summary: row.summary,
          bodyMarkdown: row.bodyMarkdown,
          breaking: row.breaking,
          maintainerNotes: row.maintainerNotes,
          shippedAt: row.shippedAt,
          updatedAt: now,
        },
      });
  }
}

export async function upsertReleaseNoteEntry(
  entry: ReleaseNoteEntry,
): Promise<void> {
  await upsertReleaseNoteEntries([entry]);
}
