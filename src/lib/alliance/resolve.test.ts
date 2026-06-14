import { describe, expect, it, vi } from "vitest";

import * as alliance from "@/lib/alliance/resolve";
import * as fetchModule from "@/lib/base44/fetch";

const connection = {
  token: "t",
  appId: "app",
  originUrl: "https://ashed.online",
};

describe("normalizeAllianceTag", () => {
  it("trims tags", () => {
    expect(alliance.normalizeAllianceTag("  LFgo ")).toBe("LFgo");
  });
});

describe("findAllianceByTag", () => {
  it("finds alliances case-insensitively", () => {
    expect(
      alliance.findAllianceByTag(
        [{ id: "a1", tag: "LFgo", name: "LFgo Alliance" }],
        "lfgo",
      )?.id,
    ).toBe("a1");
  });

  it("returns undefined for empty tags", () => {
    expect(alliance.findAllianceByTag([], "  ")).toBeUndefined();
  });
});

describe("resolveAllianceByTag", () => {
  it("resolves alliance from Base44 list", async () => {
    vi.spyOn(fetchModule, "base44ListAlliances").mockResolvedValue([
      { id: "a1", tag: "LFgo", name: "LFgo Alliance" },
    ]);

    await expect(alliance.resolveAllianceByTag(connection, "LFgo")).resolves.toEqual(
      {
        id: "a1",
        tag: "LFgo",
        name: "LFgo Alliance",
      },
    );
  });

  it("throws when tag is missing", async () => {
    await expect(alliance.resolveAllianceByTag(connection, "  ")).rejects.toThrow(
      "Alliance tag is required.",
    );
  });

  it("throws when alliance is not found", async () => {
    vi.spyOn(fetchModule, "base44ListAlliances").mockResolvedValue([]);
    vi.spyOn(alliance, "findAllianceByTag").mockReturnValue(undefined);

    await expect(alliance.resolveAllianceByTag(connection, "MISSING")).rejects.toThrow(
      'No alliance found with tag "MISSING"',
    );
  });
});
