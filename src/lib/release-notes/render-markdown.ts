import { marked } from "marked";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let extensionsRegistered = false;

function registerMarkdownExtensions(): void {
  if (extensionsRegistered) {
    return;
  }
  extensionsRegistered = true;

  marked.use({
    renderer: {
      code({ text, lang }) {
        if (lang?.trim().toLowerCase() === "mermaid") {
          return `<div class="mermaid overflow-x-auto">${escapeHtml(text)}</div>\n`;
        }
        return false;
      },
    },
  });
  marked.setOptions({ gfm: true, breaks: true });
}

export function renderReleaseNoteMarkdown(markdown: string): string {
  registerMarkdownExtensions();
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }

  return marked.parse(trimmed, { async: false }) as string;
}
