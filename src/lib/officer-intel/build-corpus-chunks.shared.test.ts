import { describe, expect, it } from "vitest";

import {
  buildActionItemChunk,
  buildApprovedNoteChunks,
  buildSessionMetadataLine,
  OFFICER_INTEL_CHUNK_MAX_CHARS,
  splitTextIntoChunks,
} from "@/lib/officer-intel/build-corpus-chunks.shared";

describe("buildSessionMetadataLine", () => {
  it("includes title, channel, and date", () => {
    expect(
      buildSessionMetadataLine({
        title: "Sunday planning",
        channelLabel: "R4/R5",
        sessionAt: "2026-07-20T18:00:00.000Z",
      }),
    ).toBe(
      "Session: Sunday planning | Channel: R4/R5 | Date: 2026-07-20T18:00:00.000Z",
    );
  });
});

describe("buildApprovedNoteChunks", () => {
  it("prefixes each chunk with session metadata", () => {
    const chunks = buildApprovedNoteChunks({
      note: {
        summary: "We agreed to push VS prep.",
        keyDecisions: ["Focus on top 25"],
        openQuestions: ["Who leads trains?"],
      },
      session: {
        title: "Officer sync",
        channelLabel: null,
        sessionAt: null,
      },
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.startsWith("Session: Officer sync")).toBe(true);
      expect(chunk).toContain("We agreed to push VS prep.");
    }
  });

  it("splits long summaries into multiple chunks", () => {
    const longParagraph = "A".repeat(OFFICER_INTEL_CHUNK_MAX_CHARS + 500);
    const chunks = buildApprovedNoteChunks({
      note: {
        summary: `${longParagraph}\n\n${longParagraph}`,
        keyDecisions: [],
        openQuestions: [],
      },
      session: {
        title: "Long meeting",
        channelLabel: "Alliance",
        sessionAt: "2026-07-01T00:00:00.000Z",
      },
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(
        OFFICER_INTEL_CHUNK_MAX_CHARS + 200,
      );
    }
  });
});

describe("splitTextIntoChunks", () => {
  it("prefers paragraph boundaries", () => {
    const chunks = splitTextIntoChunks("First paragraph.\n\nSecond paragraph.");
    expect(chunks).toEqual(["First paragraph.\n\nSecond paragraph."]);
  });
});

describe("buildActionItemChunk", () => {
  it("formats title, description, assignee, and due", () => {
    const chunk = buildActionItemChunk({
      item: {
        title: "Assign train conductor",
        description: "Lock before Friday reset.",
        assigneeMemberName: "CommanderOne",
        assigneeNameRaw: null,
        dueAt: "2026-07-30T12:00:00.000Z",
        dueHint: null,
      },
      session: {
        title: "Weekly sync",
        channelLabel: "Officers",
        sessionAt: null,
      },
    });

    expect(chunk).toContain("Session: Weekly sync | Channel: Officers");
    expect(chunk).toContain("Assign train conductor");
    expect(chunk).toContain("Lock before Friday reset.");
    expect(chunk).toContain("Assignee: CommanderOne");
    expect(chunk).toContain("Due: 2026-07-30T12:00:00.000Z");
  });
});
