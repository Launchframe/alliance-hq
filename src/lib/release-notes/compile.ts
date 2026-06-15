import fs from "node:fs";
import path from "node:path";

import type { TagDiffReleaseInputs } from "./git";
import {
  extractMarkdownBullets,
  extractMarkdownSection,
  parseReleaseNoteMarkdown,
  readReleaseNoteFile,
  replaceOrInsertMarkdownSection,
  stringifyReleaseNoteMarkdown,
} from "./markdown";
import {
  RELEASE_NOTE_SECTION_HEADINGS,
  RELEASE_NOTES_DIR,
  type CompiledReleaseNoteDraft,
} from "./types";

export type CompileReleaseNoteDraftOptions = {
  repoRoot: string;
  noteFilePath: string;
  diff: TagDiffReleaseInputs;
  releaseVersion?: string;
  title?: string;
  shippedAt?: string | null;
};

function bulletsFromCommits(commits: TagDiffReleaseInputs["commits"]): string[] {
  return commits
    .map((commit) => commit.subject.trim())
    .filter(Boolean)
    .map((subject) => subject.replace(/\s*\(#\d+\)\s*$/, "").trim())
    .filter(Boolean);
}

function uniqueBullets(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

function buildSummary(options: {
  title: string;
  bullets: string[];
  ghReleaseBody: string | null;
}): string {
  if (options.ghReleaseBody) {
    const firstParagraph = options.ghReleaseBody
      .split(/\r?\n\r?\n/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith("#") && !part.startsWith("*"));

    if (firstParagraph) {
      return firstParagraph.replace(/\*\*/g, "").slice(0, 500);
    }
  }

  if (options.bullets.length === 0) {
    return `${options.title} — maintenance release with no notable workflow changes.`;
  }

  if (options.bullets.length === 1) {
    return options.bullets[0];
  }

  return `${options.title} — ${options.bullets.slice(0, 3).join("; ")}.`;
}

export function compileBackfillReleaseNoteDraft(options: {
  noteFilePath: string;
  diff: TagDiffReleaseInputs;
  releaseVersion: string;
  title: string;
  shippedAt: string;
  maxSummaryBullets?: number;
}): string {
  const bullets = uniqueBullets(
    bulletsFromCommits([...options.diff.commits].reverse()),
  ).slice(0, options.maxSummaryBullets ?? 12);

  const summary =
    bullets.length > 0
      ? bullets.map((bullet) => `- ${bullet}`).join("\n")
      : `- ${options.title}`;

  const body = [
    "## Working notes",
    "",
    "- Backfilled from main branch deploy history.",
    "",
    `## ${RELEASE_NOTE_SECTION_HEADINGS.summary}`,
    "",
    summary,
    "",
    `## ${RELEASE_NOTE_SECTION_HEADINGS.breaking}`,
    "",
    `## ${RELEASE_NOTE_SECTION_HEADINGS.maintainerNotes}`,
    "",
  ].join("\n");

  return stringifyReleaseNoteMarkdown(
    {
      title: options.title,
      status: "shipped",
      release_version: options.releaseVersion,
      shipped_at: options.shippedAt,
    },
    body,
  );
}

export function compileReleaseNoteDraft(
  options: CompileReleaseNoteDraftOptions,
): CompiledReleaseNoteDraft {
  const existingContent = fs.existsSync(options.noteFilePath)
    ? readReleaseNoteFile(options.noteFilePath)
    : "";

  const { frontmatter, body } = parseReleaseNoteMarkdown(existingContent);
  const workingBullets = extractMarkdownBullets(
    extractMarkdownSection(body, RELEASE_NOTE_SECTION_HEADINGS.workingNotes),
  );

  const summaryBullets = uniqueBullets([
    ...workingBullets,
    ...bulletsFromCommits(options.diff.commits),
  ]);

  const title =
    options.title ??
    String(
      frontmatter.title ??
        `Alliance HQ ${options.releaseVersion ?? ""}`.trim(),
    ).trim();

  let nextBody = body;
  nextBody = replaceOrInsertMarkdownSection(
    nextBody,
    RELEASE_NOTE_SECTION_HEADINGS.summary,
    buildSummary({
      title,
      bullets: summaryBullets,
      ghReleaseBody: options.diff.ghReleaseBody,
    }),
  );

  const nextFrontmatter = {
    ...frontmatter,
    title,
    status: "ready" as const,
    ...(options.releaseVersion
      ? { release_version: options.releaseVersion }
      : {}),
    ...(options.shippedAt ? { shipped_at: options.shippedAt } : {}),
  };

  return {
    filePath: options.noteFilePath,
    content: stringifyReleaseNoteMarkdown(nextFrontmatter, nextBody),
    frontmatterStatus: "ready",
  };
}

export function resolveActiveReleaseNoteFile(repoRoot: string): string | null {
  const dir = path.join(repoRoot, RELEASE_NOTES_DIR);
  if (!fs.existsSync(dir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name.endsWith(".md") &&
        !name.startsWith("_") &&
        name.toLowerCase() !== "readme.md",
    )
    .map((name) => {
      const filePath = path.join(dir, name);
      const { frontmatter } = parseReleaseNoteMarkdown(
        readReleaseNoteFile(filePath),
      );
      const status = String(frontmatter.status ?? "draft");
      const mtime = fs.statSync(filePath).mtimeMs;
      return { filePath, status, mtime };
    })
    .filter((entry) => entry.status === "draft" || entry.status === "ready");

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length > 1) {
    const listing = candidates.map((entry) => entry.filePath).join("\n");
    throw new Error(
      `Multiple active release note files found; pass --note explicitly:\n${listing}`,
    );
  }

  return candidates[0].filePath;
}

export function patchReleaseNoteFrontmatter(
  content: string,
  patch: {
    release_version: string;
    status: "shipped";
    shipped_at: string;
  },
): string {
  const { frontmatter, body } = parseReleaseNoteMarkdown(content);

  return stringifyReleaseNoteMarkdown(
    {
      ...frontmatter,
      release_version: patch.release_version,
      status: patch.status,
      shipped_at: patch.shipped_at,
    },
    body,
  );
}

export function assertReleaseNoteReadyForShip(content: string): void {
  const { frontmatter, body } = parseReleaseNoteMarkdown(content);

  if (!body.includes(`## ${RELEASE_NOTE_SECTION_HEADINGS.summary}`)) {
    throw new Error(
      `Release note missing required section: ${RELEASE_NOTE_SECTION_HEADINGS.summary}`,
    );
  }

  const status = String(frontmatter.status ?? "draft");
  if (status !== "ready" && status !== "shipped") {
    throw new Error(
      `Release note must be status: ready before shipping (found ${status})`,
    );
  }
}

export function formatReleaseNoteForGitHub(entry: {
  title: string;
  version: string;
  summary: string;
  breaking?: string[];
}): string {
  const lines = [`## ${entry.title}`, "", entry.summary];

  if (entry.breaking && entry.breaking.length > 0) {
    lines.push("", "### Breaking changes", "");
    for (const bullet of entry.breaking) {
      lines.push(`- ${bullet}`);
    }
  }

  return lines.join("\n");
}
