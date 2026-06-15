#!/usr/bin/env tsx
/**
 * Re-post the latest shipped release note to Discord.
 *
 * Usage:
 *   npm run release:notify-discord
 *   npm run release:notify-discord -- --version 0.2.0
 */

import path from "node:path";

import "dotenv/config";

import { collectShippedReleaseNoteEntries } from "../../src/lib/release-notes/publish";
import { postReleaseNoteToDiscord } from "../../src/lib/release-notes/discord";
import { compareAppVersions } from "../../src/lib/release-notes/version";

function parseArgs(argv: string[]) {
  const options = {
    version: undefined as string | undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version" && argv[i + 1]) options.version = argv[++i];
  }

  return options;
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_RELEASE_NOTES_CHANNEL_ID?.trim();

  if (!token || !channelId) {
    throw new Error(
      "DISCORD_BOT_TOKEN and DISCORD_RELEASE_NOTES_CHANNEL_ID are required",
    );
  }

  const entries = collectShippedReleaseNoteEntries(repoRoot);
  if (entries.length === 0) {
    throw new Error("No shipped release notes found");
  }

  const entry = args.version
    ? entries.find((item) => item.version === args.version)
    : [...entries].sort((a, b) => compareAppVersions(b.version, a.version))[0];

  if (!entry) {
    throw new Error(`No shipped release note for version ${args.version}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const releasesUrl = appUrl ? `${appUrl}/releases` : undefined;

  await postReleaseNoteToDiscord({
    token,
    channelId,
    entry,
    releasesUrl,
  });

  console.log(`Posted release note v${entry.version} to Discord`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
