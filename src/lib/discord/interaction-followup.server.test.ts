import { describe, expect, it, vi, afterEach } from "vitest";

import { discordOriginalInteractionUrl } from "@/lib/discord/interaction-followup.server";

function fetchPatchBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls[0] as unknown as
    | [string, RequestInit]
    | undefined;
  expect(call).toBeDefined();
  return JSON.parse(String(call![1].body)) as Record<string, unknown>;
}

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
    const body = fetchPatchBody(fetchMock);
    expect(body).toEqual({
      content: "done",
      components: [],
      flags: 64,
    });
  });

  it("PATCHes confirm button components when provided", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { editDiscordOriginalInteraction } = await import(
      "@/lib/discord/interaction-followup.server"
    );
    const components = [{ type: 1, components: [{ type: 2, custom_id: "x" }] }];
    await editDiscordOriginalInteraction({
      applicationId: "app",
      interactionToken: "tok",
      content: "confirm?",
      components,
      ephemeral: true,
    });
    const body = fetchPatchBody(fetchMock);
    expect(body.components).toEqual(components);
  });
});
