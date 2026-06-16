import fs from "node:fs";

import type { ReleaseNoteEntry, ReleaseNoteFrontmatter } from "./types";
import {
  HQ_RELEASE_NOTES_EDGE_CONFIG_KEY,
  RELEASE_NOTE_SECTION_HEADINGS,
  RELEASE_NOTES_DIR,
} from "./types";

export { HQ_RELEASE_NOTES_EDGE_CONFIG_KEY, RELEASE_NOTES_DIR };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseReleaseNoteMarkdown(content: string): {
  frontmatter: ReleaseNoteFrontmatter;
  body: string;
} {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  return {
    frontmatter: parseSimpleYamlFrontmatter(match[1]),
    body: match[2].trim(),
  };
}

export function stringifyReleaseNoteMarkdown(
  frontmatter: ReleaseNoteFrontmatter,
  body: string,
): string {
  const yaml = stringifySimpleYamlFrontmatter(frontmatter);
  return `---\n${yaml}---\n\n${body.trim()}\n`;
}

function parseSimpleYamlFrontmatter(raw: string): ReleaseNoteFrontmatter {
  const result: ReleaseNoteFrontmatter = {};
  let currentListKey: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const listMatch = trimmed.match(/^- (.+)$/);
    if (listMatch && currentListKey) {
      const existing = result[currentListKey];
      const nextValue = unquoteYamlScalar(listMatch[1]);
      if (Array.isArray(existing)) {
        existing.push(nextValue);
      } else {
        result[currentListKey] = [nextValue];
      }
      continue;
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    currentListKey = null;

    if (rawValue === "") {
      result[key] = [];
      currentListKey = key;
      continue;
    }

    if (rawValue === "null") {
      result[key] = null;
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      result[key] = inner
        ? inner.split(",").map((part) => unquoteYamlScalar(part.trim()))
        : [];
      continue;
    }

    result[key] = unquoteYamlScalar(rawValue);
  }

  return result;
}

function stringifySimpleYamlFrontmatter(
  frontmatter: ReleaseNoteFrontmatter,
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value == null) {
      lines.push(`${key}: null`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }

      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${quoteYamlScalar(String(item))}`);
      }
      continue;
    }

    lines.push(`${key}: ${quoteYamlScalar(String(value))}`);
  }

  return `${lines.join("\n")}\n`;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function quoteYamlScalar(value: string): string {
  if (/[:#]|^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return value;
}

export function extractMarkdownSection(
  body: string,
  heading: string,
): string | null {
  const headingLine = `## ${heading}`;
  const lines = body.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line.trim() === headingLine);
  if (startIdx === -1) {
    return null;
  }

  const contentLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) {
      break;
    }
    contentLines.push(lines[i]!);
  }

  const section = contentLines.join("\n").trim();
  return section || null;
}

export function extractMarkdownBullets(section: string | null): string[] {
  if (!section) {
    return [];
  }

  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export function replaceOrInsertMarkdownSection(
  body: string,
  heading: string,
  sectionContent: string,
): string {
  const headingLine = `## ${heading}`;
  const sectionBlock = `## ${heading}\n\n${sectionContent.trim()}\n`;
  const lines = body.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line.trim() === headingLine);

  if (startIdx !== -1) {
    let endIdx = startIdx + 1;
    while (endIdx < lines.length && !/^## /.test(lines[endIdx]!)) {
      endIdx++;
    }
    const before = lines.slice(0, startIdx).join("\n");
    const after = lines.slice(endIdx).join("\n");
    return [before, sectionBlock.trimEnd(), after]
      .filter((part) => part.length > 0)
      .join("\n\n")
      .trim();
  }

  const workingNotesHeading = `## ${RELEASE_NOTE_SECTION_HEADINGS.workingNotes}`;
  if (body.includes(workingNotesHeading)) {
    return body.replace(
      workingNotesHeading,
      `${sectionBlock}\n${workingNotesHeading}`,
    );
  }

  return `${body.trim()}\n\n${sectionBlock}`.trim();
}

function buildPublicBodyMarkdown(body: string): string {
  const sections = [
    RELEASE_NOTE_SECTION_HEADINGS.summary,
    RELEASE_NOTE_SECTION_HEADINGS.breaking,
    RELEASE_NOTE_SECTION_HEADINGS.maintainerNotes,
  ];

  const parts: string[] = [];
  for (const heading of sections) {
    const section = extractMarkdownSection(body, heading);
    if (section) {
      parts.push(`## ${heading}\n\n${section}`);
    }
  }

  return parts.join("\n\n").trim();
}

export function distillReleaseNoteMarkdown(
  filePath: string,
  content: string,
): ReleaseNoteEntry | null {
  const { frontmatter, body } = parseReleaseNoteMarkdown(content);
  const status = String(frontmatter.status ?? "draft");

  if (status !== "shipped") {
    return null;
  }

  const version = String(frontmatter.release_version ?? "").trim();
  const title = String(frontmatter.title ?? "").trim();

  if (!version || !title) {
    throw new Error(
      `${filePath}: shipped release notes require release_version and title in frontmatter`,
    );
  }

  const summary =
    extractMarkdownSection(body, RELEASE_NOTE_SECTION_HEADINGS.summary) ?? "";
  const breaking = extractMarkdownBullets(
    extractMarkdownSection(body, RELEASE_NOTE_SECTION_HEADINGS.breaking),
  );
  const maintainerNotes = extractMarkdownBullets(
    extractMarkdownSection(
      body,
      RELEASE_NOTE_SECTION_HEADINGS.maintainerNotes,
    ),
  );

  const entry: ReleaseNoteEntry = {
    version,
    title,
    summary,
    bodyMarkdown: buildPublicBodyMarkdown(body),
  };

  if (frontmatter.shipped_at) {
    entry.shippedAt = String(frontmatter.shipped_at);
  }

  if (breaking.length > 0) {
    entry.breaking = breaking;
  }

  if (maintainerNotes.length > 0) {
    entry.maintainerNotes = maintainerNotes;
  }

  return entry;
}

export function listReleaseNoteFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  return fs
    .readdirSync(rootDir)
    .filter(
      (name) =>
        name.endsWith(".md") &&
        !name.startsWith("_") &&
        name.toLowerCase() !== "readme.md",
    )
    .map((name) => `${rootDir}/${name}`)
    .sort();
}

export function readReleaseNoteFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}
