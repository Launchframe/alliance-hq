#!/usr/bin/env tsx
/**
 * Publish shipped release notes to Vercel Edge Config.
 *
 * Usage:
 *   npm run release-notes:publish
 *   npm run release-notes:publish -- --dry-run
 *   npm run release-notes:publish -- --all-shipped
 */

import path from "node:path";

import "dotenv/config";

import { publishReleaseNotesToEdgeConfig } from "../../src/lib/release-notes/publish";
import { readPackageVersion } from "../../src/lib/release-notes/version";

function parseArgs(argv: string[]) {
  const options = {
    dryRun: false,
    requirePackageVersion: undefined as string | undefined,
    skipRequirePackageVersion: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--skip-require-package-version") {
      options.skipRequirePackageVersion = true;
    } else if (arg === "--require-package-version" && argv[i + 1]) {
      options.requirePackageVersion = argv[++i];
    } else if (arg === "--all-shipped") {
      options.skipRequirePackageVersion = true;
    }
  }

  return options;
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const args = parseArgs(process.argv.slice(2));
  const packageVersion = readPackageVersion(repoRoot);

  const result = await publishReleaseNotesToEdgeConfig({
    repoRoot,
    dryRun: args.dryRun,
    requirePackageVersion: args.skipRequirePackageVersion
      ? null
      : (args.requirePackageVersion ?? packageVersion),
  });

  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(result.entries, null, 2)}\n`);
    return;
  }

  console.log(
    `Published ${result.entries.length} release note entries to Edge Config key ${result.edgeConfigKey}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
