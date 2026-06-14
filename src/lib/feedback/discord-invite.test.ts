import { describe, expect, it } from "vitest";

import { resolveDiscordInviteAction } from "@/lib/feedback/discord-invite";

describe("resolveDiscordInviteAction", () => {
  it("opens a configured invite URL", () => {
    expect(
      resolveDiscordInviteAction("https://discord.gg/example"),
    ).toEqual({
      type: "open",
      url: "https://discord.gg/example",
    });
  });

  it("treats blank env values as missing", () => {
    expect(resolveDiscordInviteAction(undefined)).toEqual({ type: "missing" });
    expect(resolveDiscordInviteAction(null)).toEqual({ type: "missing" });
    expect(resolveDiscordInviteAction("")).toEqual({ type: "missing" });
    expect(resolveDiscordInviteAction("   ")).toEqual({ type: "missing" });
  });
});
