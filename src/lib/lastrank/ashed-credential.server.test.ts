import { describe, expect, it } from "vitest";

import { lastRankBotCredentialInstallError } from "@/lib/lastrank/ashed-credential.server";

describe("lastRankBotCredentialInstallError", () => {
  it("rejects missing alliance access", () => {
    expect(
      lastRankBotCredentialInstallError({
        ashedAlliance: undefined,
        allianceTag: "LFgo",
      }),
    ).toMatch(/does not have access/i);
  });

  it("rejects Ashed collaborators", () => {
    expect(
      lastRankBotCredentialInstallError({
        ashedAlliance: { id: "ashed-1", accessRole: "maintainer" },
        allianceTag: "LFgo",
      }),
    ).toMatch(/owner/i);
  });

  it("allows Ashed owners", () => {
    expect(
      lastRankBotCredentialInstallError({
        ashedAlliance: { id: "ashed-1", accessRole: "owner" },
        allianceTag: "LFgo",
      }),
    ).toBeNull();
  });
});
