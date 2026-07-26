import type { ReleaseNoteEntry } from "./types";
import { RELEASE_NOTES_DIR } from "./types";
import {
  distillReleaseNoteMarkdown,
  listReleaseNoteFiles,
  readReleaseNoteFile,
} from "./markdown";
import { upsertReleaseNoteEntries } from "./db";
import { compareAppVersions } from "./version";

export type PublishReleaseNotesOptions = {
  repoRoot: string;
  requirePackageVersion?: string | null;
  dryRun?: boolean;
};

export type PublishReleaseNotesResult = {
  entries: ReleaseNoteEntry[];
  dryRun: boolean;
};

export function collectShippedReleaseNoteEntries(
  repoRoot: string,
): ReleaseNoteEntry[] {
  const dir = `${repoRoot}/${RELEASE_NOTES_DIR}`;
  const entries: ReleaseNoteEntry[] = [];

  for (const filePath of listReleaseNoteFiles(dir)) {
    const content = readReleaseNoteFile(filePath);
    const entry = distillReleaseNoteMarkdown(filePath, content);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries.sort((a, b) => compareAppVersions(a.version, b.version));
}

export async function publishReleaseNotesToDatabase(
  options: PublishReleaseNotesOptions,
): Promise<PublishReleaseNotesResult> {
  const entries = collectShippedReleaseNoteEntries(options.repoRoot);

  if (options.requirePackageVersion) {
    const hasMatchingEntry = entries.some(
      (entry) => entry.version === options.requirePackageVersion,
    );

    if (!hasMatchingEntry) {
      throw new Error(
        `No shipped release note with release_version=${options.requirePackageVersion}`,
      );
    }
  }

  if (options.dryRun) {
    return {
      entries,
      dryRun: true,
    };
  }

  await upsertReleaseNoteEntries(entries);

  return {
    entries,
    dryRun: false,
  };
}
