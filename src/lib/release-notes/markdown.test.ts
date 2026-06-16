import { describe, expect, it } from "vitest";

import {
  distillReleaseNoteMarkdown,
  parseReleaseNoteMarkdown,
  stringifyReleaseNoteMarkdown,
} from "./markdown";

describe("release note markdown", () => {
  it("round-trips frontmatter", () => {
    const content = stringifyReleaseNoteMarkdown(
      {
        title: "Alliance HQ v0.2.0",
        status: "ready",
        release_version: "0.2.0",
      },
      "## Summary\n\n- First bullet.",
    );

    const parsed = parseReleaseNoteMarkdown(content);
    expect(parsed.frontmatter.title).toBe("Alliance HQ v0.2.0");
    expect(parsed.frontmatter.status).toBe("ready");
    expect(parsed.body).toContain("## Summary");
  });

  it("distills shipped notes with public body", () => {
    const content = stringifyReleaseNoteMarkdown(
      {
        title: "Alliance HQ v0.2.0",
        status: "shipped",
        release_version: "0.2.0",
        shipped_at: "2026-06-15",
      },
      [
        "## Working notes",
        "",
        "- internal only",
        "",
        "## Summary",
        "",
        "- User-facing change",
        "",
        "## Breaking changes",
        "",
        "- API shape changed",
      ].join("\n"),
    );

    const entry = distillReleaseNoteMarkdown("docs/release-notes/test.md", content);
    expect(entry).toMatchObject({
      version: "0.2.0",
      title: "Alliance HQ v0.2.0",
      summary: "- User-facing change",
      breaking: ["API shape changed"],
    });
    expect(entry?.bodyMarkdown).toContain("## Summary");
    expect(entry?.bodyMarkdown).not.toContain("Working notes");
  });

  it("distills multi-line Summary sections", () => {
    const content = stringifyReleaseNoteMarkdown(
      {
        title: "Big release",
        status: "shipped",
        release_version: "0.7.0",
      },
      [
        "## Summary",
        "",
        "- First user-facing change",
        "- Second user-facing change",
        "",
        "## Platform maintainer notes",
        "",
        "- Run migration",
      ].join("\n"),
    );

    const entry = distillReleaseNoteMarkdown("docs/release-notes/test.md", content);
    expect(entry?.summary).toBe(
      "- First user-facing change\n- Second user-facing change",
    );
    expect(entry?.bodyMarkdown).toContain("- Second user-facing change");
    expect(entry?.maintainerNotes).toEqual(["Run migration"]);
  });

  it("skips non-shipped notes", () => {
    const content = stringifyReleaseNoteMarkdown(
      { title: "Draft", status: "draft" },
      "## Summary\n\n- todo",
    );

    expect(distillReleaseNoteMarkdown("x.md", content)).toBeNull();
  });
});
