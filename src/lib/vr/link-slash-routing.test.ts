import { describe, expect, it } from "vitest";

import { linkSlashUsesCommanderFlow } from "@/lib/vr/link-slash-routing";

describe("linkSlashUsesCommanderFlow", () => {
  it("uses browser authorize for plain /link without name or uid", () => {
    expect(linkSlashUsesCommanderFlow({})).toBe(false);
    expect(linkSlashUsesCommanderFlow({ name: "", uid: "" })).toBe(false);
  });

  it("uses commander flow when name or uid is provided on /link", () => {
    expect(linkSlashUsesCommanderFlow({ name: "Commander" })).toBe(true);
    expect(linkSlashUsesCommanderFlow({ uid: "1234567890123456" })).toBe(true);
    expect(
      linkSlashUsesCommanderFlow({ name: "Commander", uid: "1234567890123456" }),
    ).toBe(true);
  });
});
