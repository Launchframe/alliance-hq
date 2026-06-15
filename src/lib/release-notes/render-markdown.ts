import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

export function renderReleaseNoteMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }

  return marked.parse(trimmed, { async: false }) as string;
}
