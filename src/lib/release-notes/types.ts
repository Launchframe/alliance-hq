export type ReleaseNoteFrontmatter = {
  title?: string;
  status?: "draft" | "ready" | "shipped";
  release_version?: string;
  shipped_at?: string | null;
  [key: string]: unknown;
};

export type ReleaseNoteEntry = {
  version: string;
  title: string;
  shippedAt?: string;
  summary: string;
  breaking?: string[];
  maintainerNotes?: string[];
  bodyMarkdown: string;
};

export type CompiledReleaseNoteDraft = {
  filePath: string;
  content: string;
  frontmatterStatus: "ready";
};

export const HQ_RELEASE_NOTES_EDGE_CONFIG_KEY = "hqReleaseNotes";

export const RELEASE_NOTES_DIR = "docs/release-notes";

export const RELEASE_NOTE_SECTION_HEADINGS = {
  workingNotes: "Working notes",
  summary: "Summary",
  breaking: "Breaking changes",
  maintainerNotes: "Platform maintainer notes",
} as const;
