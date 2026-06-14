import { describe, expect, it } from "vitest";

import {
  SSE_MAX_CONNECTION_MS,
  sseChunk,
} from "@/app/api/events/video-jobs/route";

describe("video-jobs SSE helpers", () => {
  it("formats SSE event chunks", () => {
    expect(sseChunk("reconnect", { t: 1 })).toBe(
      'event: reconnect\ndata: {"t":1}\n\n',
    );
  });

  it("closes before Vercel 300s limit", () => {
    expect(SSE_MAX_CONNECTION_MS).toBeLessThan(300_000);
    expect(SSE_MAX_CONNECTION_MS).toBeGreaterThan(60_000);
  });
});
