import { describe, expect, it } from "vitest";

import {
  needsLastWarAvatarRefresh,
  pickAvatarFromProviders,
} from "@/lib/profile/resolve-avatar";

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

describe("needsLastWarAvatarRefresh", () => {
  const base = {
    primaryGameUid: "1234567890121203",
    avatarSource: "lastwar" as const,
    avatarUrl: null as string | null,
    avatarRefreshedAt: null as Date | null,
  };

  it("is false without a primary game UID", () => {
    expect(
      needsLastWarAvatarRefresh({ ...base, primaryGameUid: null }),
    ).toBe(false);
  });

  it("is true when never refreshed (even with null avatarUrl)", () => {
    expect(needsLastWarAvatarRefresh(base)).toBe(true);
  });

  it("is false within TTL after a failed lookup (null URL + refreshedAt)", () => {
    expect(
      needsLastWarAvatarRefresh({
        ...base,
        avatarUrl: null,
        avatarRefreshedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("is true when forceRefresh is set", () => {
    expect(
      needsLastWarAvatarRefresh(
        {
          ...base,
          avatarUrl: null,
          avatarRefreshedAt: new Date(),
        },
        { forceRefresh: true },
      ),
    ).toBe(true);
  });
});
