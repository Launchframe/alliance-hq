import { describe, expect, it } from "vitest";
import { HISTORY_MESSAGE_LENGTH, HISTORY_MESSAGE_LIMIT, HISTORY_TEXT_BYTES, historyInitSchema, parseHistoryListCursor, parseHistoryText, parseHistoryScreenshot } from "./imports.shared";

describe("history list cursors", () => {
  const cursor = { version: 1, scope: "alliance:author", updatedAt: "2026-09-15T12:00:00.123456Z", id: "source-one" };
  it("preserves scope and database timestamp precision", () => {
    expect(parseHistoryListCursor(JSON.stringify(cursor))).toEqual(cursor);
    expect(parseHistoryListCursor(null)).toBeNull();
  });
  it("rejects malformed, unbounded, and unsupported cursors", () => {
    for (const raw of ["", "{", "x".repeat(701), "null", JSON.stringify({ ...cursor, version: 2 }), JSON.stringify({ ...cursor, scope: "" }), JSON.stringify({ ...cursor, updatedAt: "yesterday" }), JSON.stringify({ ...cursor, id: "../private" })]) {
      expect(() => parseHistoryListCursor(raw)).toThrow();
    }
  });
});

describe("reviewed history adapters", () => {
  it("retains OCR text for review when noisy headers prevent sender parsing", () => {
    const rawLines = ["Alliance", "[TESTJAlpha", "Groups setup and ready.", "[TEST|Beta", "First message"];
    expect(parseHistoryScreenshot({ messages: [], rawLines }, "file-one", 2)).toEqual([{ sender: null, body: rawLines.slice(1).join("\n"), sentAt: null, externalId: null, sourceImageIndex: 2, locator: "file-one:ocr:0" }]);
  });
  it("keeps recognized messages and ignores an empty screenshot", () => {
    expect(parseHistoryScreenshot({ messages: [{ senderName: "Alpha", originalText: "First message" }], rawLines: ["[TEST]Alpha", "First message"] }, "file-one", 0)[0]).toMatchObject({ sender: "Alpha", body: "First message", sourceImageIndex: 0 });
    expect(parseHistoryScreenshot({ messages: [], rawLines: ["Alliance", "", "Send a message"] }, "file-one", 0)).toEqual([]);
  });
  it("bounds and redacts unattributed OCR without truncating Unicode text", () => {
    const text = "x".repeat(HISTORY_MESSAGE_LENGTH - 1) + String.fromCodePoint(0x1d400) + "End";
    const messages = parseHistoryScreenshot({ messages: [], rawLines: [text] }, "file-one", 1);
    expect(messages.map((message) => message.body).join("")).toBe(text);
    expect(messages.every((message) => message.body.length <= HISTORY_MESSAGE_LENGTH && message.sender === null && message.sourceImageIndex === 1)).toBe(true);
    expect(new Set(messages.map((message) => message.locator)).size).toBe(messages.length);
    const redacted = parseHistoryScreenshot({ messages: [], rawLines: [`Player ${"1".repeat(14)} token=example-secret`] }, "file-one", 1);
    expect(redacted[0].body).not.toMatch(/\d{12,20}|example-secret/);
  });
  it("requires checksummed compatible files and bounds total image bytes", () => {
    const file = { name: "capture.png", contentType: "image/png", size: 20 * 1024 * 1024, sha256: "a".repeat(64) };
    const input = { expectedScope: "alliance:author", requestId: "request-one", title: "History", kind: "screenshots", locale: "en-US", files: [file] };
    expect(historyInitSchema.safeParse(input).success).toBe(true);
    expect(historyInitSchema.safeParse({ ...input, files: Array(4).fill(file) }).success).toBe(false);
    expect(historyInitSchema.safeParse({ ...input, kind: "text" }).success).toBe(false);
    expect(historyInitSchema.safeParse({ ...input, files: [{ ...file, sha256: "invalid" }] }).success).toBe(false);
  });
  it("keeps unknown dates and senders unknown for Markdown", () => {
    const messages = parseHistoryText("markdown", "# Decisions\n\nCheck the roster.", "file-one");
    expect(messages[0]).toMatchObject({ sender: null, sentAt: null, body: "# Decisions\n\nCheck the roster." });
  });
  it("accepts the documented Discord export shape and retains stable locators", () => {
    const messages = parseHistoryText("discord_json", JSON.stringify({ guild: { id: "guild" }, channel: { id: "channel" }, messages: [{ id: "message-one", timestamp: "2026-09-13T12:00:00Z", author: { name: "Cookie" }, content: "Check roster" }] }), "file-one");
    expect(messages[0]).toMatchObject({ externalId: "message-one", sender: "Cookie", body: "Check roster", locator: "file-one:message:message-one" });
  });
  it("rejects unsupported exports instead of guessing their fields", () => {
    expect(() => parseHistoryText("discord_json", JSON.stringify({ chat: [{ text: "Unknown format" }] }), "file")).toThrow();
  });
  it("rejects unknown versions even when Discord-shaped metadata is present", () => {
    const input = { schemaVersion: 2, guild: { id: "guild" }, channel: { id: "channel" }, messages: [{ id: "one", timestamp: null, author: null, content: "Text" }] };
    expect(() => parseHistoryText("discord_json", JSON.stringify(input), "file")).toThrow();
  });
  it("deduplicates identical message IDs but refuses conflicting versions", () => {
    const message = { id: "one", timestamp: null, author: null, content: "First" };
    const input = { schemaVersion: 1, messages: [message, message] };
    expect(parseHistoryText("discord_json", JSON.stringify(input), "file")).toHaveLength(1);
    input.messages[1] = { ...message, content: "Changed" };
    expect(() => parseHistoryText("discord_json", JSON.stringify(input), "file")).toThrow();
  });
  it("chunks long text without inventing dates or breaking surrogate pairs", () => {
    const text = "a".repeat(HISTORY_MESSAGE_LENGTH - 1) + String.fromCodePoint(0x1d400) + "End";
    const messages = parseHistoryText("text", text, "file");
    expect(messages.map((message) => message.body).join("")).toBe(text);
    expect(messages.every((message) => message.body.length <= HISTORY_MESSAGE_LENGTH && message.sentAt === null)).toBe(true);
    expect(messages[0].body).toHaveLength(HISTORY_MESSAGE_LENGTH - 1);
  });
  it("enforces byte, record and binary-input limits", () => {
    expect(() => parseHistoryText("text", "a".repeat(HISTORY_TEXT_BYTES + 1), "file")).toThrow();
    expect(() => parseHistoryText("text", "binary\0payload", "file")).toThrow();
    const messages = Array.from({ length: HISTORY_MESSAGE_LIMIT + 1 }, (_, index) => ({ id: String(index), timestamp: null, author: null, content: "Text" }));
    expect(() => parseHistoryText("discord_json", JSON.stringify({ schemaVersion: 1, messages }), "file")).toThrow();
  });
  it("redacts binding data and credentials in the reviewed representation", () => {
    const messages = parseHistoryText("text", `Player ${"1".repeat(14)} token=example-secret`, "file");
    expect(/\d{12,20}/.test(messages[0].body)).toBe(false);
    expect(messages[0].body.includes("example-secret")).toBe(false);
  });
});
