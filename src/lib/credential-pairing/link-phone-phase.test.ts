import { describe, expect, it } from "vitest";

import {
  getContinueToHqLabelKey,
  reduceLinkPhonePhase,
  shouldShowAlliancePicker,
} from "./link-phone-phase";

describe("reduceLinkPhonePhase", () => {
  it("starts idle and moves to showing on reveal", () => {
    expect(reduceLinkPhonePhase("idle", "reveal")).toBe("showing");
  });

  it("returns to idle when QR is hidden while showing", () => {
    expect(reduceLinkPhonePhase("showing", "hide")).toBe("idle");
  });

  it("moves to linked when pairing succeeds", () => {
    expect(reduceLinkPhonePhase("showing", "linked")).toBe("linked");
  });

  it("moves to error when pairing fails", () => {
    expect(reduceLinkPhonePhase("showing", "error")).toBe("error");
  });

  it("retries from error back to showing", () => {
    expect(reduceLinkPhonePhase("error", "retry")).toBe("showing");
  });

  it("returns to idle from error on hide", () => {
    expect(reduceLinkPhonePhase("error", "hide")).toBe("idle");
  });

  it("stays linked after linked", () => {
    expect(reduceLinkPhonePhase("linked", "reveal")).toBe("linked");
    expect(reduceLinkPhonePhase("linked", "error")).toBe("linked");
  });
});

describe("shouldShowAlliancePicker", () => {
  it("hides picker when paste input is empty or invalid", () => {
    expect(shouldShowAlliancePicker(undefined)).toBe(false);
    expect(shouldShowAlliancePicker(false)).toBe(false);
  });

  it("shows picker only when parse preview is ok", () => {
    expect(shouldShowAlliancePicker(true)).toBe(true);
  });
});

describe("getContinueToHqLabelKey", () => {
  it("uses a done-state label when phone linking is skipped", () => {
    expect(getContinueToHqLabelKey(false)).toBe(
      "steps.linkPhone.continueWithoutPhone",
    );
  });

  it("uses the linked-state label after phone linking succeeds", () => {
    expect(getContinueToHqLabelKey(true)).toBe("steps.linkPhone.continueToHq");
  });
});
