import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ r2Configured: vi.fn(), getObjectSize: vi.fn(), getObjectStream: vi.fn(), headR2ObjectMetadata: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage", () => storage);
vi.mock("@/lib/storage/r2", () => storage);
import { assertHistoryStorage, historyByteHash, readHistoryObject, readHistoryStream, validateHistoryBytes } from "./import-storage.server";

const bytes = Buffer.from("Historical source");
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL", "");
  storage.r2Configured.mockReturnValue(false);
  storage.getObjectSize.mockResolvedValue(bytes.length);
  storage.getObjectStream.mockImplementation(async () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("private history object validation", () => {
  it("validates the exact immutable bytes rather than trusting metadata", async () => {
    expect(await readHistoryObject("private-key", bytes.length, "text/plain", historyByteHash(bytes))).toEqual(bytes);
    await expect(readHistoryObject("private-key", bytes.length, "text/plain", "a".repeat(64))).rejects.toThrow("invalid");
  });
  it("bounds streamed bytes even if HEAD lies", async () => {
    await expect(readHistoryStream(await storage.getObjectStream(), 2)).rejects.toThrow("invalid");
  });
  it("rejects forged image signatures and mismatched R2 content types", async () => {
    expect(() => validateHistoryBytes(bytes, "image/png")).toThrow("invalid");
    storage.r2Configured.mockReturnValue(true);
    storage.headR2ObjectMetadata.mockResolvedValue({ size: bytes.length, contentType: "image/png" });
    await expect(readHistoryObject("staging-key", bytes.length, "text/plain", historyByteHash(bytes), true)).rejects.toThrow("invalid");
    expect(storage.getObjectStream).not.toHaveBeenCalled();
  });
  it("never falls back to ephemeral storage on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(() => assertHistoryStorage()).toThrow("not_configured");
  });
  it("rejects a stalled stream instead of accepting a partial body", async () => {
    vi.useFakeTimers();
    const promise = readHistoryStream(new ReadableStream({ start(controller) { controller.enqueue(bytes); } }), bytes.length);
    const assertion = expect(promise).rejects.toThrow("invalid");
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
  });
});
