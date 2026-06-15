#!/usr/bin/env tsx
/**
 * Compile a release note draft from working bullets + git tag diff.
 *
 * Usage:
 *   npm run release:compile-note
 *   npm run release:compile-note -- --dry-run
 *   npm run release:compile-note -- --note docs/release-notes/foo.md
 */

import fs from "node:fs";
import path from "node:path";

import "./load-env";

import {
  compileReleaseNoteDraft,
  resolveActiveReleaseNoteFile,
} from "../../src/lib/release-notes/compile";
import {
  extractTagDiffReleaseInputs,
  resolveLatestTag,
  tryFetchGhReleaseBody,
} from "../../src/lib/release-notes/git";
import { readPackageVersion } from "../../src/lib/release-notes/package-version-io";
import { RELEASE_NOTES_DIR } from "../../src/lib/release-notes/types";

function parseArgs(argv: string[]) {
  const options = {
    dryRun: false,
    note: undefined as string | undefined,
    sinceTag: undefined as string | undefined,
    untilTag: undefined as string | "HEAD" | undefined,
    out: undefined as string | undefined,
    releaseVersion: undefined as string | undefined,
    title: undefined as string | undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--note" && argv[i + 1]) options.note = argv[++i];
    else if (arg === "--since-tag" && argv[i + 1]) options.sinceTag = argv[++i];
    else if (arg === "--until-tag" && argv[i + 1]) options.untilTag = argv[++i];
    else if (arg === "--out" && argv[i + 1]) options.out = argv[++i];
    else if (arg === "--version" && argv[i + 1])
      options.releaseVersion = argv[++i];
    else if (arg === "--title" && argv[i + 1]) options.title = argv[++i];
  }

  return options;
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const args = parseArgs(process.argv.slice(2));
  const sinceTag = args.sinceTag ?? resolveLatestTag(repoRoot) ?? "v0.1.0";
  const noteFilePath =
    args.note ??
    resolveActiveReleaseNoteFile(repoRoot) ??
    path.join(repoRoot, RELEASE_NOTES_DIR, "next-release.md");

  const untilTag = args.untilTag ?? "HEAD";
  const ghTag = untilTag === "HEAD" ? null : untilTag;
  const diff = extractTagDiffReleaseInputs({
    sinceTag,
    untilTag,
    cwd: repoRoot,
    ghReleaseBody: ghTag ? tryFetchGhReleaseBody(ghTag) : null,
  });

  const draft = compileReleaseNoteDraft({
    repoRoot,
    noteFilePath,
    diff,
    releaseVersion: args.releaseVersion,
    title: args.title,
  });

  if (args.dryRun) {
    process.stdout.write(`${draft.content}\n`);
    return;
  }

  const outPath = args.out ?? noteFilePath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, draft.content);

  console.log(`Compiled release note draft: ${outPath}`);
  console.log(`Diff range: ${sinceTag}..${untilTag}`);
  console.log(`Current package.json version: ${readPackageVersion(repoRoot)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
