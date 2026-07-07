import { describe, expect, it } from "vitest";

import { isMergeTargetClaimedByOther } from "@/lib/member-link/merge-commander.server";

describe("isMergeTargetClaimedByOther", () => {
  it("blocks a Discord-only review merge into an HQ-claimed roster target", () => {
    expect(
      isMergeTargetClaimedByOther({
        requesterHqUserId: null,
        requesterDiscordUserId: "discord-new",
        targetHqUserId: "hq-existing",
        targetDiscordUserId: null,
        targetDiscordHqUserId: null,
      }),
    ).toBe(true);
  });

  it("blocks a web review merge into a Discord target without same-HQ proof", () => {
    expect(
      isMergeTargetClaimedByOther({
        requesterHqUserId: "hq-new",
        requesterDiscordUserId: null,
        targetHqUserId: null,
        targetDiscordUserId: "discord-existing",
        targetDiscordHqUserId: null,
      }),
    ).toBe(true);
  });

  it("allows a web review merge into the requester's Discord-linked target", () => {
    expect(
      isMergeTargetClaimedByOther({
        requesterHqUserId: "hq-existing",
        requesterDiscordUserId: null,
        targetHqUserId: null,
        targetDiscordUserId: "discord-existing",
        targetDiscordHqUserId: "hq-existing",
      }),
    ).toBe(false);
  });

  it("allows a Discord review merge into the same Discord user's target", () => {
    expect(
      isMergeTargetClaimedByOther({
        requesterHqUserId: null,
        requesterDiscordUserId: "discord-existing",
        targetHqUserId: null,
        targetDiscordUserId: "discord-existing",
        targetDiscordHqUserId: null,
      }),
    ).toBe(false);
  });
});
