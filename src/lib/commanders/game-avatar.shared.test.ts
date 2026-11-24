import { describe, expect, it } from "vitest";

import { isCommanderGameAvatarStale } from "@/lib/commanders/game-avatar.shared";
import { LASTWAR_AVATAR_TTL_MS } from "@/lib/profile/avatar-ttl.shared";

describe("isCommanderGameAvatarStale", () => {
  it("is stale when never refreshed", () => {
    expect(isCommanderGameAvatarStale(null)).toBe(true);
    expect(isCommanderGameAvatarStale(undefined)).toBe(true);
  });

  it("is fresh within the TTL", () => {
    expect(isCommanderGameAvatarStale(new Date())).toBe(false);
  });

  it("is stale past the TTL", () => {
    expect(
      isCommanderGameAvatarStale(
        new Date(Date.now() - LASTWAR_AVATAR_TTL_MS - 1_000),
      ),
    ).toBe(true);
  });
});
