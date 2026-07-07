import { describe, expect, it } from "vitest";

import { pathsMatchForNavigation } from "./navigation-progress.shared";

describe("pathsMatchForNavigation", () => {
  it("matches localized and logical paths", () => {
    expect(
      pathsMatchForNavigation("/members", "/members", "/members", "/members"),
    ).toBe(true);
    expect(
      pathsMatchForNavigation("/dashboard", "/members", "/dashboard", "/members"),
    ).toBe(false);
  });
});
