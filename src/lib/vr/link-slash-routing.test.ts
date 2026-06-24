import { describe, expect, it } from "vitest";

import { linkSlashUsesCommanderFlow } from "@/lib/vr/link-slash-routing";

describe("linkSlashUsesCommanderFlow", () => {
  it("uses HQ user_link when Discord still sends name on /link but HQ is not linked", () => {
    expect(linkSlashUsesCommanderFlow({ hasHqLink: false, legacyName: "Commander" })).toBe(
      false,
    );
  });

  it("uses commander flow only when HQ is linked and legacy name is present", () => {
    expect(linkSlashUsesCommanderFlow({ hasHqLink: true, legacyName: "Commander" })).toBe(
      true,
    );
  });

  it("uses HQ user_link for plain /link without legacy name", () => {
    expect(linkSlashUsesCommanderFlow({ hasHqLink: true })).toBe(false);
    expect(linkSlashUsesCommanderFlow({ hasHqLink: false })).toBe(false);
  });
});
