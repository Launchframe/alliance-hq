import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { findActiveMatchingParseConfigId } from "@/lib/video/admin-reprocess-extraction.server";

describe("findActiveMatchingParseConfigId", () => {
  const config = { mode: "fps" as const, sampleFps: 4 };

  it("returns an active equal recipe", () => {
    expect(
      findActiveMatchingParseConfigId(
        [
          {
            id: "archived-1",
            status: "archived",
            configJson: config,
          },
          {
            id: "active-1",
            status: "active",
            configJson: config,
          },
        ],
        config,
      ),
    ).toBe("active-1");
  });

  it("skips archived and draft matches so callers create a new ad-hoc config", () => {
    expect(
      findActiveMatchingParseConfigId(
        [
          {
            id: "archived-1",
            status: "archived",
            configJson: config,
          },
          {
            id: "draft-1",
            status: "draft",
            configJson: config,
          },
        ],
        config,
      ),
    ).toBeNull();
  });

  it("requires equal extraction configJson", () => {
    expect(
      findActiveMatchingParseConfigId(
        [
          {
            id: "active-other",
            status: "active",
            configJson: { mode: "fps", sampleFps: 3 },
          },
        ],
        config,
      ),
    ).toBeNull();
  });
});
