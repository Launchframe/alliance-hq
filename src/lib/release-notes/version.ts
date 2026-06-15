import fs from "node:fs";
import path from "node:path";

import semver from "semver";

import type { ReleaseNoteEntry } from "./types";

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

export type VersionBumpKind = "patch" | "minor" | "major";

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

export function compareAppVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const left = normalizeAppVersion(a);
  const right = normalizeAppVersion(b);

  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }

  return semver.compare(left, right);
}

export function normalizeAppVersion(
  version: string | null | undefined,
): string | null {
  const trimmed = version?.trim();
  if (!trimmed) {
    return null;
  }

  const valid = semver.valid(trimmed);
  if (valid) {
    return valid;
  }

  const coerced = semver.coerce(trimmed);
  return coerced?.version ?? null;
}

export function filterReleaseNotesSince(
  notes: ReleaseNoteEntry[],
  sinceVersion: string | null | undefined,
  currentVersion: string,
): ReleaseNoteEntry[] {
  const normalizedCurrent = normalizeAppVersion(currentVersion);
  if (!normalizedCurrent) {
    return [];
  }

  const sorted = [...notes].sort((a, b) =>
    compareAppVersions(a.version, b.version),
  );

  return sorted.filter((entry) => {
    const normalizedEntry = normalizeAppVersion(entry.version);
    if (!normalizedEntry) {
      return false;
    }

    if (compareAppVersions(normalizedEntry, normalizedCurrent) > 0) {
      return false;
    }

    if (!sinceVersion?.trim()) {
      return true;
    }

    return compareAppVersions(sinceVersion, normalizedEntry) < 0;
  });
}

export function hasUnreadReleaseNotes(
  lastSeenVersion: string | null | undefined,
  currentVersion: string,
  notes: ReleaseNoteEntry[],
): boolean {
  return (
    filterReleaseNotesSince(notes, lastSeenVersion, currentVersion).length > 0
  );
}

export function lastSeenReleaseVersionStorageKey(sessionId: string): string {
  return `hqLastSeenReleaseVersion:${sessionId}`;
}
