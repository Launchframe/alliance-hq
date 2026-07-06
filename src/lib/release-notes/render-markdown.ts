import { marked } from "marked";

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
          return `<div class="mermaid overflow-x-auto">${text}</div>\n`;
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
