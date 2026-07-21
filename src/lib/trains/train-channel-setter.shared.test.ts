import { describe, expect, it } from "vitest";

import {
  canSetTrainChannel,
  parseTrainChannelSetterMinRank,
} from "@/lib/trains/train-channel-setter.shared";

describe("parseTrainChannelSetterMinRank", () => {
  it("defaults unknown values to officer (R4+)", () => {
    expect(parseTrainChannelSetterMinRank(undefined)).toBe("officer");
    expect(parseTrainChannelSetterMinRank(null)).toBe("officer");
    expect(parseTrainChannelSetterMinRank("bogus")).toBe("officer");
    expect(parseTrainChannelSetterMinRank("owner")).toBe("owner");
    expect(parseTrainChannelSetterMinRank("officer")).toBe("officer");
  });
});

describe("canSetTrainChannel", () => {
  it("always allows the alliance owner", () => {
    expect(
      canSetTrainChannel({
        minRank: "owner",
        isOwner: true,
        isOfficer: false,
      }),
    ).toBe(true);
    expect(
      canSetTrainChannel({
        minRank: "officer",
        isOwner: true,
        isOfficer: false,
      }),
    ).toBe(true);
  });

  it("allows R4+ officers when min rank is officer", () => {
    expect(
      canSetTrainChannel({
        minRank: "officer",
        isOwner: false,
        isOfficer: true,
      }),
    ).toBe(true);
  });

  it("rejects R4+ officers when min rank is owner", () => {
    expect(
      canSetTrainChannel({
        minRank: "owner",
        isOwner: false,
        isOfficer: true,
      }),
    ).toBe(false);
  });

  it("rejects non-officers in both modes", () => {
    expect(
      canSetTrainChannel({
        minRank: "officer",
        isOwner: false,
        isOfficer: false,
      }),
    ).toBe(false);
    expect(
      canSetTrainChannel({
        minRank: "owner",
        isOwner: false,
        isOfficer: false,
      }),
    ).toBe(false);
  });
});
