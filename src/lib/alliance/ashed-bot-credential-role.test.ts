import { describe, expect, it } from "vitest";

import { canInstallAshedBotCredentials } from "@/lib/alliance/accessible";

describe("canInstallAshedBotCredentials", () => {
  it("allows Ashed alliance owners only", () => {
    expect(canInstallAshedBotCredentials("owner")).toBe(true);
  });

  it("rejects Ashed collaborators/maintainers", () => {
    expect(canInstallAshedBotCredentials("maintainer")).toBe(false);
  });
});
