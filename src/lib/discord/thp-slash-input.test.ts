import { describe, expect, it } from "vitest";

import { parseThpSlashInput } from "@/lib/discord/thp-slash-input";

const resolvedAttachment = {
  "9001": {
    url: "https://cdn.discordapp.com/attachments/1/9001/power.png",
    filename: "power.png",
    content_type: "image/png",
  },
};

describe("parseThpSlashInput", () => {
  it("reads legacy flat total and screenshot options", () => {
    const parsed = parseThpSlashInput({
      type: 2,
      data: {
        options: [
          { name: "total", type: 4, value: 163_460_435 },
          { name: "screenshot", type: 11, value: "9001" },
        ],
        resolved: { attachments: resolvedAttachment },
      },
    });
    expect(parsed.explicitTotal).toBe(163_460_435);
    expect(parsed.attachment?.id).toBe("9001");
  });

  it("reads screenshot subcommand with required image attachment", () => {
    const parsed = parseThpSlashInput({
      type: 2,
      data: {
        options: [
          {
            name: "screenshot",
            type: 1,
            options: [{ name: "image", type: 11, value: "9001" }],
          },
        ],
        resolved: { attachments: resolvedAttachment },
      },
    });
    expect(parsed.explicitTotal).toBeUndefined();
    expect(parsed.attachment?.filename).toBe("power.png");
  });

  it("reads total subcommand value", () => {
    const parsed = parseThpSlashInput({
      type: 2,
      data: {
        options: [
          {
            name: "total",
            type: 1,
            options: [{ name: "value", type: 4, value: 240_530_435 }],
          },
        ],
      },
    });
    expect(parsed.explicitTotal).toBe(240_530_435);
    expect(parsed.attachment).toBeNull();
  });
});
