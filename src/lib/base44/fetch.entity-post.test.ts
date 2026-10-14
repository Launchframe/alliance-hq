import { afterEach, describe, expect, it, vi } from "vitest";

import { base44EntityPost } from "./fetch";

describe("base44EntityPost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards AbortSignal to fetch (Event sync POST timeout)", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "remote-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await base44EntityPost(
      {
        token: "test-token",
        originUrl: "https://example.test",
        appId: "app-test",
      },
      "SeasonalScore",
      { score: 1 },
      { signal: controller.signal },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
