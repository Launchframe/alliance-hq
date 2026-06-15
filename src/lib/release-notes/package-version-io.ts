import fs from "node:fs";
import path from "node:path";

import semver from "semver";

export type VersionBumpKind = "patch" | "minor" | "major";

export function readPackageVersion(repoRoot: string): string {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as { version?: string };

  return String(packageJson.version ?? "").trim();
}

export function writePackageVersion(repoRoot: string, version: string): void {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as { version?: string };

  packageJson.version = version;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

export function bumpVersion(
  currentVersion: string,
  kind: VersionBumpKind = "patch",
): string {
  const parsed = semver.parse(currentVersion, { loose: true });
  if (!parsed) {
    throw new Error(`Invalid package.json version: ${currentVersion}`);
  }

  const next = semver.inc(parsed.version, kind);
  if (!next) {
    throw new Error(`Unable to bump version: ${currentVersion}`);
  }

  return next;
}
