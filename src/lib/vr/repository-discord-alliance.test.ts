import { describe, expect, it } from "vitest";

import { matchAllianceIdEnvValue } from "@/lib/vr/repository";

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
