import { describe, expect, it } from "vitest";

import { buildThpSlashDiscordResponse } from "@/lib/thp/discord-slash-response";

describe("buildThpSlashDiscordResponse", () => {
  it("returns ephemeral content for a plain success", () => {
    const response = buildThpSlashDiscordResponse(
      {
        reply: "ok",
        pending: null,
        action: { type: "none" },
      },
      { yes: "Yes", no: "No" },
    );
    expect(response.type).toBe(4);
    expect(response.data.content).toBe("ok");
    expect(response.data.flags).toBe(64);
  });

  it("attaches confirm buttons when needed", () => {
    const response = buildThpSlashDiscordResponse(
      {
        reply: "sure?",
        pending: null,
        action: { type: "none" },
        needsConfirmation: true,
        proposedTotal: 1,
      },
      { yes: "Yes", no: "No" },
    );
    expect(response.data.components?.[0]?.components).toHaveLength(2);
  });
});
