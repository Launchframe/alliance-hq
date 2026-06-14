import { describe, expect, it } from "vitest";

import { isBootstrapEmailMatch } from "@/lib/rbac/bootstrap-platform.helpers";

describe("isBootstrapEmailMatch", () => {
  it("matches configured bootstrap email case-insensitively", () => {
    expect(
      isBootstrapEmailMatch(" HubSub.LLC@gmail.com ", "hubsub.llc@gmail.com"),
    ).toBe(true);
  });

  it("returns false when bootstrap email is unset", () => {
    expect(isBootstrapEmailMatch("hubsub.llc@gmail.com", undefined)).toBe(false);
    expect(isBootstrapEmailMatch("hubsub.llc@gmail.com", "   ")).toBe(false);
  });

  it("returns false for a different user email", () => {
    expect(
      isBootstrapEmailMatch("other@example.com", "hubsub.llc@gmail.com"),
    ).toBe(false);
  });
});
