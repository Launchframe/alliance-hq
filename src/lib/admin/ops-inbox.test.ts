import { describe, expect, it } from "vitest";

import { OPS_INBOX_STUCK_QUEUED_MINUTES } from "./ops-inbox";

describe("ops-inbox constants", () => {
  it("uses 15 minute stuck queued threshold", () => {
    expect(OPS_INBOX_STUCK_QUEUED_MINUTES).toBe(15);
  });
});
