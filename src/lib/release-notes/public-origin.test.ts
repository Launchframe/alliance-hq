import { afterEach, describe, expect, it } from "vitest";

import {
  resolveReleaseNotesPageUrl,
  resolveReleaseNotesPublicOrigin,
} from "./public-origin";

describe("resolveReleaseNotesPublicOrigin", () => {
  const envKeys = ["NEXT_PUBLIC_APP_URL"] as const;
  const prev: Partial<Record<(typeof envKeys)[number], string | undefined>> =
    {};

  afterEach(() => {
    for (const key of envKeys) {
      if (prev[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev[key];
      }
    }
  });

  it("uses production origin when NEXT_PUBLIC_APP_URL is localhost", () => {
    prev.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:5175";
    expect(resolveReleaseNotesPublicOrigin()).toBe("https://frontline.gay");
    expect(resolveReleaseNotesPageUrl()).toBe(
      "https://frontline.gay/releases",
    );
  });

  it("uses configured public URL when not localhost", () => {
    prev.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay/";
    expect(resolveReleaseNotesPublicOrigin()).toBe("https://frontline.gay");
  });

  it("falls back to production when unset", () => {
    prev.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(resolveReleaseNotesPublicOrigin()).toBe("https://frontline.gay");
  });
});
