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

  it("escapes HTML in mermaid fences before dangerouslySetInnerHTML", () => {
    const html = renderReleaseNoteMarkdown(
      "```mermaid\nflowchart TD\n  A[<img src=x onerror=alert(1)>] --> B\n```",
    );

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});
