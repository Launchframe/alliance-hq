import { describe, expect, it } from "vitest";

import {
  defaultLinkedDeviceName,
  parseOsLabelFromUserAgent,
  truncateUserAgent,
} from "./user-agent";

describe("parseOsLabelFromUserAgent", () => {
  it("detects iPhone iOS versions", () => {
    expect(
      parseOsLabelFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)",
      ),
    ).toBe("iPhone (iOS 17.4)");
  });

  it("detects Android versions", () => {
    expect(parseOsLabelFromUserAgent("Mozilla/5.0 (Linux; Android 14)")).toBe(
      "Android 14",
    );
  });

  it("returns unknown for empty input", () => {
    expect(parseOsLabelFromUserAgent(null)).toBe("Unknown device");
  });
});

describe("truncateUserAgent", () => {
  it("truncates long user agent strings", () => {
    const long = "a".repeat(600);
    expect(truncateUserAgent(long)?.length).toBe(512);
  });
});

describe("defaultLinkedDeviceName", () => {
  it("uses os label when present", () => {
    expect(defaultLinkedDeviceName("Android 14")).toBe("Android 14");
  });
});
