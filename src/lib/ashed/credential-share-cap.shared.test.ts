import { describe, expect, it } from "vitest";

import { MAX_ACTIVE_CREDENTIAL_SHARES } from "@/lib/ashed/credential-share-cap.shared";

describe("MAX_ACTIVE_CREDENTIAL_SHARES", () => {
  it("allows three pending or active shares per owner", () => {
    expect(MAX_ACTIVE_CREDENTIAL_SHARES).toBe(3);
  });
});
