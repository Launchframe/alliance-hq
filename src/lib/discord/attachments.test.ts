import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadDiscordAttachment,
  parseResolvedAttachment,
} from "@/lib/discord/attachments";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseResolvedAttachment", () => {
  it("finds attachments nested under subcommands", () => {
    const parsed = parseResolvedAttachment(
      {
        data: {
          options: [
            {
              name: "screenshot",
              type: 1,
              options: [{ name: "image", type: 11, value: "42" }],
            },
          ],
          resolved: {
            attachments: {
              "42": {
                proxy_url:
                  "https://media.discordapp.net/attachments/1/42/power.png",
                filename: "power.png",
              },
            },
          },
        },
      },
      "image",
    );
    expect(parsed?.url).toContain("media.discordapp.net");
    expect(parsed?.id).toBe("42");
  });
});

describe("downloadDiscordAttachment", () => {
  it("downloads from media.discordapp.net", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async () =>
      new Response(bytes, { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const buffer = await downloadDiscordAttachment({
      id: "42",
      url: "https://media.discordapp.net/attachments/1/42/power.png",
      filename: "power.png",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://media.discordapp.net/attachments/1/42/power.png",
    );
    expect(Buffer.from(buffer)).toEqual(Buffer.from(bytes));
  });

  it("downloads from cdn.discordapp.com", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const fetchMock = vi.fn(async () =>
      new Response(bytes, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const buffer = await downloadDiscordAttachment({
      id: "7",
      url: "https://cdn.discordapp.com/attachments/1/7/power.png",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(Buffer.from(buffer)).toEqual(Buffer.from(bytes));
  });

  it("rejects unexpected attachment hosts without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadDiscordAttachment({
        id: "99",
        url: "https://evil.example/attachments/1/99/power.png",
      }),
    ).rejects.toThrow("Unexpected attachment host");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
