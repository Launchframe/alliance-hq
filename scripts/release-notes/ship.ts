#!/usr/bin/env tsx
/**
 * Ship a production release: bump version, publish Edge Config, Discord, tag.
 *
 * Usage:
 *   npm run release:ship -- --dry-run
 *   npm run release:ship -- --yes
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import "dotenv/config";

import {
  assertReleaseNoteReadyForShip,
  compileReleaseNoteDraft,
  formatReleaseNoteForGitHub,
  patchReleaseNoteFrontmatter,
  resolveActiveReleaseNoteFile,
} from "../../src/lib/release-notes/compile";
import { postReleaseNoteToDiscord } from "../../src/lib/release-notes/discord";
import {
  extractTagDiffReleaseInputs,
  resolveLatestTag,
} from "../../src/lib/release-notes/git";
import { publishReleaseNotesToEdgeConfig } from "../../src/lib/release-notes/publish";
import {
  parseReleaseNoteMarkdown,
  readReleaseNoteFile,
} from "../../src/lib/release-notes/markdown";
import {
  bumpVersion,
  readPackageVersion,
  writePackageVersion,
  type VersionBumpKind,
} from "../../src/lib/release-notes/package-version-io";

type ShipArgs = {
  dryRun: boolean;
  yes: boolean;
  note?: string;
  version?: string;
  bump: VersionBumpKind;
  skipPush: boolean;
  skipRelease: boolean;
  skipPublish: boolean;
  skipDiscord: boolean;
  skipCompile: boolean;
  forceCompile: boolean;
};

function parseArgs(argv: string[]): ShipArgs {
  const options: ShipArgs = {
    dryRun: false,
    yes: false,
    note: undefined,
    version: undefined,
    bump: "patch",
    skipPush: false,
    skipRelease: false,
    skipPublish: false,
    skipDiscord: false,
    skipCompile: false,
    forceCompile: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes") options.yes = true;
    else if (arg === "--skip-push") options.skipPush = true;
    else if (arg === "--skip-release") options.skipRelease = true;
    else if (arg === "--skip-publish") options.skipPublish = true;
    else if (arg === "--skip-discord") options.skipDiscord = true;
    else if (arg === "--skip-compile") options.skipCompile = true;
    else if (arg === "--compile") options.forceCompile = true;
    else if (arg === "--note" && argv[i + 1]) options.note = argv[++i];
    else if (arg === "--version" && argv[i + 1]) options.version = argv[++i];
    else if (arg === "--minor") options.bump = "minor";
    else if (arg === "--major") options.bump = "major";
  }

  return options;
}

function shouldCompileReleaseNote(options: {
  skipCompile: boolean;
  forceCompile: boolean;
  noteFilePath: string;
}): boolean {
  if (options.skipCompile) {
    return false;
  }
  if (options.forceCompile) {
    return true;
  }
  if (!fs.existsSync(options.noteFilePath)) {
    return true;
  }
  const { frontmatter } = parseReleaseNoteMarkdown(
    readReleaseNoteFile(options.noteFilePath),
  );
  const status = String(frontmatter.status ?? "draft");
  return status === "draft";
}

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function createGithubRelease(
  repoRoot: string,
  options: {
    version: string;
    branch: string;
    notesBody: string;
  },
): void {
  const notesFile = path.join(
    os.tmpdir(),
    `alliance-hq-release-notes-v${options.version}.md`,
  );

  try {
    fs.writeFileSync(notesFile, options.notesBody, "utf8");
    run(
      "gh",
      [
        "release",
        "create",
        `v${options.version}`,
        `--target=${options.branch}`,
        "--title",
        `v${options.version}`,
        "--notes-file",
        notesFile,
      ],
      repoRoot,
    );
  } finally {
    try {
      fs.unlinkSync(notesFile);
    } catch {
      // ignore temp cleanup failures
    }
  }
}

function gitStatusPorcelain(cwd: string): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function currentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function assertAllowedDirtyTree(repoRoot: string): void {
  const dirty = gitStatusPorcelain(repoRoot);
  if (!dirty) {
    return;
  }

  const allowed = dirty
    .split("\n")
    .filter(Boolean)
    .every((line) => {
      const file = line.slice(3).trim();
      return file.startsWith("docs/release-notes/") || file === "package.json";
    });

  if (!allowed) {
    throw new Error(`Working tree has unrelated changes:\n${dirty}`);
  }
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const args = parseArgs(process.argv.slice(2));

  if (!args.dryRun && !args.yes) {
    throw new Error("Pass --yes to execute (or use --dry-run to preview)");
  }

  const branch = currentBranch(repoRoot);
  if (branch !== "main") {
    throw new Error(`Expected to ship from main (on ${branch})`);
  }

  if (!args.dryRun) {
    assertAllowedDirtyTree(repoRoot);
  }

  const currentVersion = readPackageVersion(repoRoot);
  const nextVersion =
    args.version ?? bumpVersion(currentVersion, args.bump);

  const noteFilePath =
    args.note ??
    resolveActiveReleaseNoteFile(repoRoot) ??
    (() => {
      throw new Error("No active release note file found; pass --note");
    })();

  const sinceTag = resolveLatestTag(repoRoot) ?? `v${currentVersion}`;

  console.log(`Current version: ${currentVersion}`);
  console.log(`Next version: ${nextVersion}`);
  console.log(`Release note: ${noteFilePath}`);
  console.log(`Diff since: ${sinceTag}`);

  const priorVersion = readPackageVersion(repoRoot);
  const priorNoteContent = fs.existsSync(noteFilePath)
    ? readReleaseNoteFile(noteFilePath)
    : null;

  let compiledNoteContent: string | undefined;
  const runCompile = shouldCompileReleaseNote({
    skipCompile: args.skipCompile,
    forceCompile: args.forceCompile,
    noteFilePath,
  });

  if (runCompile) {
    console.log("Compiling release note from git diff + working bullets.");
    const diff = extractTagDiffReleaseInputs({
      sinceTag,
      untilTag: "HEAD",
      cwd: repoRoot,
    });
    const draft = compileReleaseNoteDraft({
      repoRoot,
      noteFilePath,
      diff,
      releaseVersion: nextVersion,
    });
    compiledNoteContent = draft.content;

    if (args.dryRun) {
      console.log("\n--- Compiled note preview ---");
      console.log(draft.content);
    }
  } else if (args.skipCompile) {
    console.log("Skipping release note compile (--skip-compile).");
  } else {
    console.log(
      "Using release note as written (status: ready). Pass --compile to regenerate.",
    );
  }

  let noteContent =
    compiledNoteContent ??
    (fs.existsSync(noteFilePath) ? readReleaseNoteFile(noteFilePath) : "");

  assertReleaseNoteReadyForShip(noteContent);

  const shippedAt = new Date().toISOString();
  noteContent = patchReleaseNoteFrontmatter(noteContent, {
    release_version: nextVersion,
    status: "shipped",
    shipped_at: shippedAt,
  });

  const { frontmatter, body } = parseReleaseNoteMarkdown(noteContent);
  const githubNotes = formatReleaseNoteForGitHub({
    title: String(frontmatter.title ?? `Alliance HQ v${nextVersion}`),
    version: nextVersion,
    summary:
      body.match(/^## Summary\s*$\n([\s\S]*?)(?=^## |\Z)/im)?.[1]?.trim() ??
      "",
    breaking: body
      .match(/^## Breaking changes\s*$\n([\s\S]*?)(?=^## |\Z)/im)?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2)),
  });

  if (args.dryRun) {
    console.log("\n--- package.json ---");
    console.log(`version: ${nextVersion}`);
    console.log("\n--- Patched note frontmatter ---");
    console.log(noteContent.split("\n").slice(0, 12).join("\n"));
    console.log("\n--- GitHub release notes preview ---");
    console.log(githubNotes);
    console.log(`\nWould publish Edge Config, Discord, and tag v${nextVersion}`);
    return;
  }

  writePackageVersion(repoRoot, nextVersion);
  fs.writeFileSync(noteFilePath, noteContent);

  try {
    let publishedEntry;
    if (!args.skipPublish) {
      const publishResult = await publishReleaseNotesToEdgeConfig({
        repoRoot,
        requirePackageVersion: nextVersion,
      });
      publishedEntry = publishResult.entries.find(
        (entry) => entry.version === nextVersion,
      );
    }

    if (!args.skipDiscord) {
      const token = process.env.DISCORD_BOT_TOKEN?.trim();
      const channelId = process.env.DISCORD_RELEASE_NOTES_CHANNEL_ID?.trim();
      if (!token || !channelId) {
        throw new Error(
          "DISCORD_BOT_TOKEN and DISCORD_RELEASE_NOTES_CHANNEL_ID are required",
        );
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
      const entry =
        publishedEntry ??
        (await publishReleaseNotesToEdgeConfig({
          repoRoot,
          dryRun: true,
        })).entries.find((item) => item.version === nextVersion);

      if (!entry) {
        throw new Error(`No distilled entry for version ${nextVersion}`);
      }

      await postReleaseNoteToDiscord({
        token,
        channelId,
        entry,
        releasesUrl: appUrl ? `${appUrl}/releases` : undefined,
      });
    }

    run("git", ["add", "package.json", noteFilePath], repoRoot);
    run(
      "git",
      ["commit", "-m", `Release v${nextVersion}.`],
      repoRoot,
    );

    if (!args.skipPush) {
      run("git", ["push", "origin", branch], repoRoot);
    }

    if (!args.skipRelease) {
      createGithubRelease(repoRoot, {
        version: nextVersion,
        branch,
        notesBody: githubNotes,
      });
    }
  } catch (error) {
    writePackageVersion(repoRoot, priorVersion);
    if (priorNoteContent !== null) {
      fs.writeFileSync(noteFilePath, priorNoteContent);
    } else if (fs.existsSync(noteFilePath)) {
      fs.unlinkSync(noteFilePath);
    }

    try {
      if (priorNoteContent !== null) {
        run("git", ["reset", "--", "package.json", noteFilePath], repoRoot);
      } else {
        run("git", ["reset", "--", "package.json"], repoRoot);
      }
    } catch {
      // ignore cleanup failures
    }

    throw error;
  }

  console.log(`\nShipped v${nextVersion}`);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://alliance-hq.vercel.app";
  console.log(`Production: ${appUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
