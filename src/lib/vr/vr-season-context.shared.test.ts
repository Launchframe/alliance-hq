import { describe, expect, it } from "vitest";

import { resolveVrSeasonContextFromParts } from "./vr-season-lock.shared";

describe("resolveVrSeasonContextFromParts", () => {
  const effectiveActive = { seasonKey: "4", isPostSeason: false };
  const effectivePost = { seasonKey: "4", isPostSeason: true };

  it("locks VR updates during post-season", () => {
    expect(
      resolveVrSeasonContextFromParts({
        envSeasonKey: null,
        effective: effectivePost,
        sandbox: { enabled: false, seasonKey: null },
      }),
    ).toEqual({
      seasonKey: "4",
      isPostSeason: true,
      vrUpdatesLocked: true,
      priorSeason: "4",
      vrSandboxActive: false,
    });
  });

  it("allows VR updates during an active season", () => {
    expect(
      resolveVrSeasonContextFromParts({
        envSeasonKey: null,
        effective: effectiveActive,
        sandbox: { enabled: false, seasonKey: null },
      }),
    ).toEqual({
      seasonKey: "4",
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
      vrSandboxActive: false,
    });
  });

  it("sandbox mode unlocks VR regardless of post-season", () => {
    expect(
      resolveVrSeasonContextFromParts({
        envSeasonKey: null,
        effective: effectivePost,
        sandbox: { enabled: true, seasonKey: "sandbox:abc" },
      }),
    ).toEqual({
      seasonKey: "sandbox:abc",
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
      vrSandboxActive: true,
    });
  });

  it("env season key bypasses sandbox and post-season lock", () => {
    expect(
      resolveVrSeasonContextFromParts({
        envSeasonKey: "dev",
        effective: effectivePost,
        sandbox: { enabled: true, seasonKey: "sandbox:abc" },
      }),
    ).toEqual({
      seasonKey: "dev",
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
      vrSandboxActive: false,
    });
  });
});
