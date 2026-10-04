import { describe, expect, it } from "vitest";

import {
  formatContextAwarePageTitle,
  formatVideoJobPageTitle,
} from "./page-title.shared";

describe("formatContextAwarePageTitle", () => {
  it("prefixes alliance tag when present", () => {
    expect(
      formatContextAwarePageTitle("Train Hub", { allianceTag: "LFgo" }),
    ).toBe("LFgo Train Hub");
  });

  it("prefixes admin label without alliance tag", () => {
    expect(formatContextAwarePageTitle("video jobs", { admin: true })).toBe(
      "Admin video jobs",
    );
  });

  it("returns page title alone when no context", () => {
    expect(formatContextAwarePageTitle("Sign in")).toBe("Sign in");
  });
});

describe("formatVideoJobPageTitle", () => {
  it("formats job slug", () => {
    expect(formatVideoJobPageTitle("sharp-butterfly-ab12")).toBe(
      "Video sharp-butterfly-ab12",
    );
  });

  it("prefers file name when provided via caller", () => {
    expect(formatVideoJobPageTitle("my-recording.mp4")).toBe(
      "Video my-recording.mp4",
    );
  });
});
