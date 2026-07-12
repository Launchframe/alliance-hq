import { describe, expect, it, vi, afterEach } from "vitest";

import { discordOriginalInteractionUrl } from "@/lib/discord/interaction-followup.server";

describe("discordOriginalInteractionUrl", () => {
  it("targets the @original webhook message", () => {
    expect(discordOriginalInteractionUrl("app123", "tok456")).toBe(
      "https://discord.com/api/v10/webhooks/app123/tok456/messages/@original",
    );
  });
});

describe("editDiscordOriginalInteraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("PATCHes content and clears components by default", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { editDiscordOriginalInteraction } = await import(
      "@/lib/discord/interaction-followup.server"
    );
    const ok = await editDiscordOriginalInteraction({
      applicationId: "app",
      interactionToken: "tok",
      content: "done",
      ephemeral: true,
    });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/webhooks/app/tok/messages/@original",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );
    expect(body).toEqual({
      content: "done",
      components: [],
      flags: 64,
    });
  });
});
