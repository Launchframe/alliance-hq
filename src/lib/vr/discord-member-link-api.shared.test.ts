import { describe, expect, it } from "vitest";

import { serializeDiscordMemberLinkForOfficerApi } from "./discord-member-link-api.shared";

describe("serializeDiscordMemberLinkForOfficerApi", () => {
  it("replaces full gameUid with last4 and omits plaintext UID", () => {
    const serialized = serializeDiscordMemberLinkForOfficerApi({
      id: "link-1",
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      discordUsername: "alice",
      ashedMemberId: "member-1",
      memberDisplayName: "Alice",
      gameUid: "1234567890121203",
      linkedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(serialized).toEqual({
      id: "link-1",
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      discordUsername: "alice",
      ashedMemberId: "member-1",
      memberDisplayName: "Alice",
      gameUidLast4: "1203",
      linkedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(serialized).not.toHaveProperty("gameUid");
  });
});
