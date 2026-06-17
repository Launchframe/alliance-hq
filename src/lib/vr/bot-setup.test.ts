import { afterEach, describe, expect, it } from "vitest";

import { isTagEligible } from "@/lib/vr/bot-setup";

describe("isTagEligible", () => {
  const original = process.env.ELIGIBLE_BOT_ALLIANCE_LINK_TAGS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ELIGIBLE_BOT_ALLIANCE_LINK_TAGS;
    } else {
      process.env.ELIGIBLE_BOT_ALLIANCE_LINK_TAGS = original;
    }
  });

  it("allows all tags when env is unset", () => {
    delete process.env.ELIGIBLE_BOT_ALLIANCE_LINK_TAGS;
    expect(isTagEligible("LFgo")).toBe(true);
    expect(isTagEligible("anything")).toBe(true);
  });

  it("allows only listed tags when env is set", () => {
    process.env.ELIGIBLE_BOT_ALLIANCE_LINK_TAGS = "LFgo,Other";
    expect(isTagEligible("LFgo")).toBe(true);
    expect(isTagEligible("lfgo")).toBe(true);
    expect(isTagEligible("Other")).toBe(true);
    expect(isTagEligible("blocked")).toBe(false);
  });
});
