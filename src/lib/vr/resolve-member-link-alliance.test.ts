import { describe, expect, it } from "vitest";

import { namesMatch } from "@/lib/vr/link-helpers";
import { parseGameServerNumberFromUid } from "@/lib/lastwar/player-lookup";

describe("resolveAllianceIdForDiscordMemberLink cold-start inputs", () => {
  it("parses server number from fixture UID for native alliance lookup", () => {
    expect(parseGameServerNumberFromUid("1234567890121203")).toBe(1203);
  });

  it("requires reported name to match Last War lookup before roster match", () => {
    expect(namesMatch("ColdStartOwner", "ColdStartOwner")).toBe(true);
    expect(namesMatch("Wrong", "ColdStartOwner")).toBe(false);
  });
});
