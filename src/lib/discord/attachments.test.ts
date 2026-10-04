import { describe, expect, it } from "vitest";

import {
  parseResolvedAttachment,
} from "@/lib/discord/attachments";

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
