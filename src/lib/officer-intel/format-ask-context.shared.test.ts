import { describe, expect, it } from "vitest";

import {
  citationsFromChunks,
  citationHref,
  formatOpenActionItemsForPrompt,
  formatRetrievedChunksForPrompt,
  shouldRefreshThreadSummary,
  truncateTranscriptForSynthesis,
  MAX_SYNTHESIZE_TRANSCRIPT_CHARS,
} from "@/lib/officer-intel/format-ask-context.shared";

describe("format-ask-context", () => {
  it("refreshes the thread summary every three turns", () => {
    expect(shouldRefreshThreadSummary(0)).toBe(false);
    expect(shouldRefreshThreadSummary(2)).toBe(false);
    expect(shouldRefreshThreadSummary(3)).toBe(true);
    expect(shouldRefreshThreadSummary(6)).toBe(true);
  });

  it("builds note and action-item hrefs", () => {
    expect(citationHref("approved_note", "note-1")).toBe(
      "/officer-intel/notes/note-1",
    );
    expect(citationHref("action_item", "item 2")).toBe(
      "/officer-intel/action-items?focus=item%202",
    );
  });

  it("dedupes citations by source", () => {
    const citations = citationsFromChunks([
      {
        sourceType: "approved_note",
        sourceId: "n1",
        sessionId: "s1",
        text: "a",
        sessionTitle: "Banks",
        channelLabel: "R4 & R5",
        sessionAt: "2026-07-25T00:00:00.000Z",
      },
      {
        sourceType: "approved_note",
        sourceId: "n1",
        sessionId: "s1",
        text: "b",
        sessionTitle: "Banks",
        channelLabel: "R4 & R5",
        sessionAt: "2026-07-25T00:00:00.000Z",
      },
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.href).toBe("/officer-intel/notes/n1");
  });

  it("formats retrieved chunks with numbered tags", () => {
    const text = formatRetrievedChunksForPrompt([
      {
        sourceType: "approved_note",
        sourceId: "n1",
        sessionId: "s1",
        text: "Hold the east bank.",
        sessionTitle: "War room",
        channelLabel: null,
        sessionAt: null,
      },
    ]);
    expect(text).toContain("[1 approved meeting notes session=\"War room\" id=n1]");
    expect(text).toContain("Hold the east bank.");
  });

  it("formats open action items compactly", () => {
    const text = formatOpenActionItemsForPrompt([
      {
        title: "Move rally",
        description: "North gate",
        assigneeMemberName: "Ada",
        assigneeNameRaw: null,
        dueAt: "2026-07-26T00:00:00.000Z",
        dueHint: null,
        status: "open",
        priority: "high",
      },
    ]);
    expect(text).toContain("Move rally");
    expect(text).toContain("Ada");
    expect(text).toContain("high/open");
  });

  it("truncates oversized synthesize transcripts", () => {
    const huge = "x".repeat(MAX_SYNTHESIZE_TRANSCRIPT_CHARS + 50);
    const truncated = truncateTranscriptForSynthesis(huge);
    expect(truncated.length).toBeLessThan(huge.length);
    expect(truncated).toContain("truncated");
  });
});
