import { describe, expect, it } from "vitest";

import { pickAvatarFromProviders } from "@/lib/profile/resolve-avatar";

describe("pickAvatarFromProviders", () => {
  it("prefers Google over Discord and Last War", () => {
    expect(
      pickAvatarFromProviders(
        [
          { provider: "discord", avatarUrl: "https://cdn.discordapp.com/a.png" },
          { provider: "google", avatarUrl: "https://lh3.googleusercontent.com/a" },
        ],
        "https://lastwar-h5.lastwargame.com/pic.png",
      ),
    ).toEqual({
      avatarUrl: "https://lh3.googleusercontent.com/a",
      avatarSource: "google",
    });
  });

  it("prefers Discord over Last War when Google is absent", () => {
    expect(
      pickAvatarFromProviders(
        [{ provider: "discord", avatarUrl: "https://cdn.discordapp.com/a.png" }],
        "https://lastwar-h5.lastwargame.com/pic.png",
      ),
    ).toEqual({
      avatarUrl: "https://cdn.discordapp.com/a.png",
      avatarSource: "discord",
    });
  });

  it("uses Last War when OAuth providers have no URL", () => {
    expect(
      pickAvatarFromProviders(
        [{ provider: "google", avatarUrl: null }],
        "https://lastwar-h5.lastwargame.com/pic.png",
      ),
    ).toEqual({
      avatarUrl: "https://lastwar-h5.lastwargame.com/pic.png",
      avatarSource: "lastwar",
    });
  });

  it("returns null when no sources are available", () => {
    expect(pickAvatarFromProviders([], null)).toEqual({
      avatarUrl: null,
      avatarSource: null,
    });
  });
});
