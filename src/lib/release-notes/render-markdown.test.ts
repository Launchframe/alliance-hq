import { describe, expect, it } from "vitest";

import { renderReleaseNoteMarkdown } from "@/lib/release-notes/render-markdown";

describe("renderReleaseNoteMarkdown", () => {
  it("renders mermaid fences as mermaid containers instead of code blocks", () => {
    const html = renderReleaseNoteMarkdown(
      "# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n",
    );

    expect(html).toContain('<div class="mermaid overflow-x-auto">');
    expect(html).toContain("flowchart TD");
    expect(html).not.toContain("<pre>");
    expect(html).not.toContain("language-mermaid");
  });

  it("still renders ordinary fenced code as pre/code", () => {
    const html = renderReleaseNoteMarkdown("```ts\nconst x = 1;\n```");

    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });
});
