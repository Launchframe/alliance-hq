import { describe, expect, it } from "vitest";

import {
  hasConflictingDiscordGameUidClaim,
  hasConflictingHqGameUidClaim,
} from "@/lib/member-link/link-claim-guards.shared";

describe("link-claim-guards.shared", () => {
  it("blocks HQ linking when the same UID is already claimed by another HQ user", () => {
    expect(
      hasConflictingHqGameUidClaim({
        hqUserId: "hq-new",
        ashedMemberId: "member-new",
        hqClaims: [{ hqUserId: "hq-existing", ashedMemberId: "member-old" }],
        discordClaims: [],
      }),
    ).toBe(true);
  });

  it("blocks HQ stale-roster relinks that would move the same UID to a new roster row", () => {
    expect(
      hasConflictingHqGameUidClaim({
        hqUserId: "hq-existing",
        ashedMemberId: "member-new",
        hqClaims: [{ hqUserId: "hq-existing", ashedMemberId: "member-old" }],
        discordClaims: [],
      }),
    ).toBe(true);
  });

  it("allows HQ linking when Discord has the same HQ account and roster member", () => {
    expect(
      hasConflictingHqGameUidClaim({
        hqUserId: "hq-existing",
        ashedMemberId: "member-old",
        hqClaims: [],
        discordClaims: [
          {
            discordUserId: "discord-existing",
            hqUserId: "hq-existing",
            ashedMemberId: "member-old",
          },
        ],
      }),
    ).toBe(false);
  });

  it("blocks Discord linking when an unlinked Discord user enters an HQ-claimed UID", () => {
    expect(
      hasConflictingDiscordGameUidClaim({
        discordUserId: "discord-new",
        hqUserId: null,
        ashedMemberId: "member-old",
        hqClaims: [{ hqUserId: "hq-existing", ashedMemberId: "member-old" }],
        discordClaims: [],
      }),
    ).toBe(true);
  });

  it("allows Discord linking when it mirrors the same HQ account and roster member", () => {
    expect(
      hasConflictingDiscordGameUidClaim({
        discordUserId: "discord-existing",
        hqUserId: "hq-existing",
        ashedMemberId: "member-old",
        hqClaims: [{ hqUserId: "hq-existing", ashedMemberId: "member-old" }],
        discordClaims: [],
      }),
    ).toBe(false);
  });

  it("blocks Discord stale-roster relinks for the same user and UID", () => {
    expect(
      hasConflictingDiscordGameUidClaim({
        discordUserId: "discord-existing",
        hqUserId: "hq-existing",
        ashedMemberId: "member-new",
        hqClaims: [],
        discordClaims: [
          {
            discordUserId: "discord-existing",
            hqUserId: "hq-existing",
            ashedMemberId: "member-old",
          },
        ],
      }),
    ).toBe(true);
  });
});
