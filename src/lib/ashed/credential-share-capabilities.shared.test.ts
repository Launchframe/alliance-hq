import { describe, expect, it } from "vitest";

import {
  isCredentialShareCapability,
  parseCredentialShareCapabilities,
} from "@/lib/ashed/credential-share-capabilities.shared";

describe("credential-share-capabilities", () => {
  it("recognizes known capabilities", () => {
    expect(isCredentialShareCapability("roster:sync")).toBe(true);
    expect(isCredentialShareCapability("unknown")).toBe(false);
  });

  it("parses capability arrays", () => {
    expect(
      parseCredentialShareCapabilities(["roster:sync", "bad", "video:process"]),
    ).toEqual(["roster:sync", "video:process"]);
  });
});
