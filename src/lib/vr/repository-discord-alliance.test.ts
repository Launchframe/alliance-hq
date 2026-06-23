import { describe, expect, it } from "vitest";

import {
  matchAllianceIdEnvValue,
  resolveGuildAllianceIdWithLegacyFallback,
} from "@/lib/vr/repository";

describe("matchAllianceIdEnvValue", () => {
  const rows = [
    { id: "hq-nanoid-abc", ashedAllianceId: "6a034217c66737ea6bef7187" },
    { id: "other-alliance", ashedAllianceId: "aaaaaaaaaaaaaaaaaaaaaaaa" },
  ];

  it("matches HQ alliances.id", () => {
    expect(matchAllianceIdEnvValue("hq-nanoid-abc", rows)).toBe("hq-nanoid-abc");
  });

  it("matches Ashed alliance id when env uses ashed_alliance_id", () => {
    expect(matchAllianceIdEnvValue("6a034217c66737ea6bef7187", rows)).toBe(
      "hq-nanoid-abc",
    );
  });

  it("returns null when env value is unknown", () => {
    expect(matchAllianceIdEnvValue("missing-id", rows)).toBeNull();
  });
});

describe("resolveGuildAllianceIdWithLegacyFallback", () => {
  const registered = "alliance-registered";
  const legacy = "alliance-legacy";
  const legacyGuild = "guild-legacy-123";
  const otherGuild = "guild-other-456";

  it("returns registered alliance when guild is linked", () => {
    expect(
      resolveGuildAllianceIdWithLegacyFallback({
        guildId: otherGuild,
        registeredAllianceId: registered,
        legacyAllianceId: legacy,
        legacyGuildId: legacyGuild,
      }),
    ).toBe(registered);
  });

  it("returns null for unregistered guild even when legacy env is set", () => {
    expect(
      resolveGuildAllianceIdWithLegacyFallback({
        guildId: otherGuild,
        registeredAllianceId: null,
        legacyAllianceId: legacy,
        legacyGuildId: legacyGuild,
      }),
    ).toBeNull();
  });

  it("allows legacy env fallback only for the configured legacy guild", () => {
    expect(
      resolveGuildAllianceIdWithLegacyFallback({
        guildId: legacyGuild,
        registeredAllianceId: null,
        legacyAllianceId: legacy,
        legacyGuildId: legacyGuild,
      }),
    ).toBe(legacy);
  });

  it("returns legacy alliance when guild id is absent (cron paths)", () => {
    expect(
      resolveGuildAllianceIdWithLegacyFallback({
        guildId: null,
        registeredAllianceId: null,
        legacyAllianceId: legacy,
        legacyGuildId: legacyGuild,
      }),
    ).toBe(legacy);
  });
});
