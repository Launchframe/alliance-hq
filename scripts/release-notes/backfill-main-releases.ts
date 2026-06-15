#!/usr/bin/env tsx
/**
 * Backfill shipped release notes for each production deploy on main.
 *
 * Usage:
 *   npm run release:backfill-main
 *   npm run release:backfill-main -- --dry-run
 *   npm run release:backfill-main -- --create-tags
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import "dotenv/config";

import { compileBackfillReleaseNoteDraft } from "../../src/lib/release-notes/compile";
import {
  extractCommitRangeReleaseInputs,
  getTagDate,
} from "../../src/lib/release-notes/git";
import { RELEASE_NOTES_DIR } from "../../src/lib/release-notes/types";
import {
  readPackageVersion,
  writePackageVersion,
} from "../../src/lib/release-notes/package-version-io";

type BackfillRange = {
  version: string;
  sinceRef: string | null;
  untilRef: string;
  title: string;
  filename: string;
  maintainerNotes?: string[];
};

const BACKFILL_RANGES: BackfillRange[] = [
  {
    version: "0.1.0",
    sinceRef: null,
    untilRef: "467e0bc",
    title: "Alliance HQ launch — portal shell, connect flow, and video pipeline",
    filename: "v0.1.0-initial-platform.md",
  },
  {
    version: "0.2.0",
    sinceRef: "467e0bc",
    untilRef: "2dbe9e5",
    title: "HQ RBAC, Ashed role sync, and admin portal (#1)",
    filename: "v0.2.0-hq-rbac-admin-portal.md",
    maintainerNotes: [
      "Platform maintainers can bootstrap via PLATFORM_BOOTSTRAP_EMAIL when no maintainer exists.",
    ],
  },
  {
    version: "0.3.0",
    sinceRef: "2dbe9e5",
    untilRef: "acc9d85",
    title: "Admin audit log filters, server time, and timezone prefs (#6)",
    filename: "v0.3.0-admin-audit-filters.md",
  },
  {
    version: "0.3.1",
    sinceRef: "acc9d85",
    untilRef: "d01f351",
    title: "Hotfix: clearer database error messages (#8)",
    filename: "v0.3.1-db-error-hotfix.md",
    maintainerNotes: [
      "Reduced per-request DB connection usage to avoid pool exhaustion on Vercel.",
    ],
  },
  {
    version: "0.3.2",
    sinceRef: "d01f351",
    untilRef: "234aa66",
    title: "Hotfix: Intl date formatting on connected sessions",
    filename: "v0.3.2-intl-datestyle-hotfix.md",
  },
  {
    version: "0.4.0",
    sinceRef: "234aa66",
    untilRef: "0c811fd",
    title: "Community feedback, translation reports, and v1 app icon (#3)",
    filename: "v0.4.0-community-feedback.md",
  },
  {
    version: "0.5.0",
    sinceRef: "0c811fd",
    untilRef: "da0f973",
    title: "Link mobile devices via QR and manage linked sessions (#10)",
    filename: "v0.5.0-device-linking.md",
  },
  {
    version: "0.6.0",
    sinceRef: "da0f973",
    untilRef: "ff6d66d",
    title: "Viral Resistance tracker and official HQ Discord bot (#9)",
    filename: "v0.6.0-viral-resistance-discord-bot.md",
    maintainerNotes: [
      "Register Discord slash commands with npm run discord:register-commands after deploy.",
      "Set DISCORD_* and VR_BOT_ASHED_BEARER_TOKEN env vars before enabling the bot.",
    ],
  },
];

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes("--dry-run"),
    createTags: argv.includes("--create-tags"),
    gitRef: argv.includes("--git-ref")
      ? argv[argv.indexOf("--git-ref") + 1]
      : "origin/main",
  };
}

function appendMaintainerNotes(content: string, notes: string[]): string {
  if (notes.length === 0) {
    return content;
  }

  const block = notes.map((note) => `- ${note}`).join("\n");
  return content.replace(
    /## Platform maintainer notes\s*\n\s*$/m,
    `## Platform maintainer notes\n\n${block}\n`,
  );
}

function createGitTag(
  repoRoot: string,
  version: string,
  commitRef: string,
  title: string,
): void {
  const tag = `v${version}`;
  try {
    execFileSync("git", ["tag", "-a", tag, "-m", title, commitRef], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    console.log(`Tagged ${tag} at ${commitRef}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      console.warn(`Tag ${tag} already exists — skipping.`);
      return;
    }
    throw error;
  }
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const args = parseArgs(process.argv.slice(2));
  const notesDir = path.join(repoRoot, RELEASE_NOTES_DIR);
  const outputs: string[] = [];

  for (const range of BACKFILL_RANGES) {
    const diff = extractCommitRangeReleaseInputs({
      sinceRef: range.sinceRef,
      untilRef: range.untilRef,
      cwd: repoRoot,
    });

    const shippedAt =
      getTagDate(range.untilRef, repoRoot) ??
      new Date().toISOString().slice(0, 10);

    const outPath = path.join(notesDir, range.filename);
    let content = compileBackfillReleaseNoteDraft({
      noteFilePath: outPath,
      diff,
      releaseVersion: range.version,
      title: range.title,
      shippedAt,
      maxSummaryBullets: range.version === "0.1.0" ? 20 : 12,
    });

    if (range.maintainerNotes?.length) {
      content = appendMaintainerNotes(content, range.maintainerNotes);
    }

    if (args.dryRun) {
      outputs.push(`# ${outPath}\n${content}`);
      continue;
    }

    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(outPath, content);
    outputs.push(outPath);

    if (args.createTags) {
      createGitTag(repoRoot, range.version, range.untilRef, range.title);
    }
  }

  const latestVersion = BACKFILL_RANGES.at(-1)?.version;
  if (!args.dryRun && latestVersion) {
    const current = readPackageVersion(repoRoot);
    if (current !== latestVersion) {
      writePackageVersion(repoRoot, latestVersion);
      console.log(`Updated package.json version: ${current} → ${latestVersion}`);
    }
  }

  if (args.dryRun) {
    process.stdout.write(`${outputs.join("\n\n")}\n`);
    return;
  }

  console.log("Generated backfill release notes:");
  for (const filePath of outputs) {
    console.log(`- ${filePath}`);
  }

  console.log(
    `\nNext: npm run release-notes:publish -- --all-shipped --dry-run`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
