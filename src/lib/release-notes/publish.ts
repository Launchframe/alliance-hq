import type { ReleaseNoteEntry } from "./types";
import { HQ_RELEASE_NOTES_EDGE_CONFIG_KEY, RELEASE_NOTES_DIR } from "./types";
import {
  distillReleaseNoteMarkdown,
  listReleaseNoteFiles,
  readReleaseNoteFile,
} from "./markdown";
import { compareAppVersions } from "./version";

export type PublishReleaseNotesOptions = {
  repoRoot: string;
  requirePackageVersion?: string | null;
  dryRun?: boolean;
  vercelApiToken?: string;
  edgeConfigId?: string;
};

export type PublishReleaseNotesResult = {
  entries: ReleaseNoteEntry[];
  edgeConfigKey: string;
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

export async function publishReleaseNotesToEdgeConfig(
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
      edgeConfigKey: HQ_RELEASE_NOTES_EDGE_CONFIG_KEY,
      dryRun: true,
    };
  }

  const token = options.vercelApiToken ?? process.env.VERCEL_API_TOKEN;
  const edgeConfigId = options.edgeConfigId ?? process.env.EDGE_CONFIG_ID;

  if (!token || !edgeConfigId) {
    throw new Error("VERCEL_API_TOKEN and EDGE_CONFIG_ID are required to publish");
  }

  const response = await fetch(
    `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            operation: "upsert",
            key: HQ_RELEASE_NOTES_EDGE_CONFIG_KEY,
            value: entries,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Edge Config publish failed (${response.status}): ${body}`);
  }

  return {
    entries,
    edgeConfigKey: HQ_RELEASE_NOTES_EDGE_CONFIG_KEY,
    dryRun: false,
  };
}
