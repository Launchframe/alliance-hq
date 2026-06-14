import { describe, expect, it } from "vitest";

import {
  AllianceSelectionError,
  accessRoleToSystemRole,
  filterAccessibleAlliances,
  normalizeAshedEmail,
  resolveSelectedAccessibleAlliance,
  resolveSystemRoleForAlliance,
  userAllianceAccessRole,
} from "@/lib/alliance/accessible";
import type { AshedAllianceRow } from "@/lib/alliance/types";

const LFgo: AshedAllianceRow = {
  id: "6a034217c66737ea6bef7187",
  tag: "LFgo",
  name: "Live Free Die Hard",
  owner_id: "69f7b8f9cb3fec52c7765a9e",
  owner_email: "erikhass54@gmail.com",
  collaborators: [
    "red171sc@gmail.com",
    "hubsub.llc@gmail.com",
    "vmazzuchelli@gmail.com",
  ],
};

const OtherAlliance: AshedAllianceRow = {
  id: "other-id",
  tag: "Other",
  name: "Other Alliance",
  owner_email: "someone@example.com",
  collaborators: [],
};

describe("normalizeAshedEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeAshedEmail("  HubSub.LLC@gmail.com ")).toBe(
      "hubsub.llc@gmail.com",
    );
  });
});

describe("userAllianceAccessRole", () => {
  it("returns owner for owner_email match", () => {
    expect(
      userAllianceAccessRole(LFgo, { email: "erikhass54@gmail.com" }),
    ).toBe("owner");
  });

  it("returns owner for owner_id match", () => {
    expect(
      userAllianceAccessRole(LFgo, {
        email: "erikhass54@gmail.com",
        id: "69f7b8f9cb3fec52c7765a9e",
      }),
    ).toBe("owner");
  });

  it("returns maintainer for collaborator email (Hub Sub on LFgo)", () => {
    expect(
      userAllianceAccessRole(LFgo, { email: "hubsub.llc@gmail.com" }),
    ).toBe("maintainer");
  });

  it("returns null for unrelated users", () => {
    expect(
      userAllianceAccessRole(LFgo, { email: "stranger@example.com" }),
    ).toBeNull();
  });
});

describe("filterAccessibleAlliances", () => {
  it("returns only alliances where user is owner or collaborator", () => {
    const result = filterAccessibleAlliances(
      [LFgo, OtherAlliance],
      { email: "hubsub.llc@gmail.com" },
    );

    expect(result).toEqual([
      {
        id: LFgo.id,
        tag: "LFgo",
        name: "Live Free Die Hard",
        accessRole: "maintainer",
      },
    ]);
  });

  it("sorts alliances by tag", () => {
    const a = { ...OtherAlliance, tag: "Zzz", owner_email: "me@example.com" };
    const b = { ...LFgo, owner_email: "me@example.com" };
    const result = filterAccessibleAlliances([a, b], { email: "me@example.com" });
    expect(result.map((row) => row.tag)).toEqual(["LFgo", "Zzz"]);
  });

  it("skips alliances without id or tag", () => {
    expect(
      filterAccessibleAlliances(
        [{ owner_email: "me@example.com" }, { id: "x", tag: "  " }],
        { email: "me@example.com" },
      ),
    ).toEqual([]);
  });
});

describe("resolveSelectedAccessibleAlliance", () => {
  const accessible = filterAccessibleAlliances([LFgo], {
    email: "hubsub.llc@gmail.com",
  });

  it("auto-selects when only one alliance is accessible", () => {
    expect(resolveSelectedAccessibleAlliance(accessible)).toEqual(
      accessible[0],
    );
  });

  it("selects by allianceId", () => {
    const many = filterAccessibleAlliances(
      [LFgo, { ...OtherAlliance, collaborators: ["hubsub.llc@gmail.com"] }],
      { email: "hubsub.llc@gmail.com" },
    );
    expect(
      resolveSelectedAccessibleAlliance(many, { allianceId: LFgo.id! }),
    ).toMatchObject({ tag: "LFgo" });
  });

  it("selects by allianceTag case-insensitively", () => {
    expect(
      resolveSelectedAccessibleAlliance(accessible, { allianceTag: "lfgo" }),
    ).toMatchObject({ tag: "LFgo" });
  });

  it("throws ambiguous when multiple and no selection", () => {
    const many = filterAccessibleAlliances(
      [LFgo, { ...OtherAlliance, collaborators: ["hubsub.llc@gmail.com"] }],
      { email: "hubsub.llc@gmail.com" },
    );
    expect(() => resolveSelectedAccessibleAlliance(many)).toThrow(
      AllianceSelectionError,
    );
    try {
      resolveSelectedAccessibleAlliance(many);
    } catch (error) {
      expect(error).toMatchObject({ code: "ambiguous" });
    }
  });

  it("throws none_accessible for empty list", () => {
    expect(() => resolveSelectedAccessibleAlliance([])).toThrow(
      AllianceSelectionError,
    );
    try {
      resolveSelectedAccessibleAlliance([]);
    } catch (error) {
      expect(error).toMatchObject({ code: "none_accessible" });
    }
  });

  it("throws not_accessible when selection is not allowed", () => {
    expect(() =>
      resolveSelectedAccessibleAlliance(accessible, { allianceId: "other-id" }),
    ).toThrow(AllianceSelectionError);
  });
});

describe("resolveSystemRoleForAlliance", () => {
  it("maps access roles to HQ system roles", () => {
    expect(accessRoleToSystemRole("owner")).toBe("owner");
    expect(accessRoleToSystemRole("maintainer")).toBe("maintainer");
  });

  it("returns viewer for non-admin users on the alliance row", () => {
    expect(
      resolveSystemRoleForAlliance(LFgo, { email: "random@example.com" }),
    ).toBe("viewer");
  });

  it("returns maintainer for Hub Sub on LFgo", () => {
    expect(
      resolveSystemRoleForAlliance(LFgo, { email: "hubsub.llc@gmail.com" }),
    ).toBe("maintainer");
  });
});
