import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoteMarkdown } from "@/components/notes/NoteMarkdown";
import { safeNoteLink } from "./markdown.shared";

describe("untrusted note Markdown", () => {
  it("permits ordinary links without accepting executable or credential-bearing URLs", () => {
    expect(safeNoteLink("/notes/one")).toBe("/notes/one");
    expect(safeNoteLink("https://example.test/guide")).toBe("https://example.test/guide");
    for (const href of ["javascript:alert(1)", "data:text/html,test", "//example.test", "/\\example.test", "https://user:password@example.test"]) expect(safeNoteLink(href)).toBeNull();
  });
  it("renders text and formatting without executing raw HTML or loading images", () => {
    const html = renderToStaticMarkup(createElement(NoteMarkdown, { body: "## Heading\n\n**Bold** and <script>alert(1)</script>\n\n![tracking](https://example.test/pixel.png)" }));
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('src="https://example.test');
  });
  it("does not create a link for a JavaScript destination", () => {
    const html = renderToStaticMarkup(createElement(NoteMarkdown, { body: "[unsafe](javascript:alert)" }));
    expect(html).toContain("unsafe");
    expect(html).not.toContain("href=");
  });
});
