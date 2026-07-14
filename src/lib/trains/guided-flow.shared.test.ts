import { describe, expect, it } from "vitest";

import {
  currentGuidedStep,
  guidedFlowShowPrerequisites,
  type GuidedFlowInput,
} from "@/lib/trains/guided-flow.shared";

const base: GuidedFlowInput = {
  schedulePersisted: true,
  hasConductor: true,
  vipNeeded: true,
  hasVip: true,
  locked: true,
};

describe("currentGuidedStep", () => {
  it("returns template when schedule is not persisted", () => {
    expect(
      currentGuidedStep({
        ...base,
        schedulePersisted: false,
        hasConductor: false,
        hasVip: false,
        locked: false,
      }),
    ).toBe("template");
  });

  it("returns conductor when schedule exists but no conductor", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        hasVip: false,
        locked: false,
      }),
    ).toBe("conductor");
  });

  it("returns vip when conductor assigned and VIP needed but missing", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasVip: false,
        locked: false,
      }),
    ).toBe("vip");
  });

  it("skips vip when vipNeeded is false", () => {
    expect(
      currentGuidedStep({
        ...base,
        vipNeeded: false,
        hasVip: false,
        locked: false,
      }),
    ).toBe("lock");
  });

  it("returns lock when assignments complete but unlocked", () => {
    expect(currentGuidedStep({ ...base, locked: false })).toBe("lock");
  });

  it("returns done when locked", () => {
    expect(currentGuidedStep(base)).toBe("done");
  });

  it("does not block on missing VS prerequisites", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe("conductor");
  });
});

describe("guidedFlowShowPrerequisites", () => {
  it("is true when VS/PIF data required and not ready", () => {
    expect(
      guidedFlowShowPrerequisites({
        ...base,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe(true);
  });

  it("is false when data is ready", () => {
    expect(
      guidedFlowShowPrerequisites({
        ...base,
        locked: false,
        vsDataRequired: true,
        vsDataReady: true,
      }),
    ).toBe(false);
  });

  it("is false when data is not required", () => {
    expect(
      guidedFlowShowPrerequisites({
        ...base,
        locked: false,
        vsDataRequired: false,
        vsDataReady: false,
      }),
    ).toBe(false);
  });

  it("is false when locked even if scores are missing", () => {
    expect(
      guidedFlowShowPrerequisites({
        ...base,
        locked: true,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe(false);
  });
});
