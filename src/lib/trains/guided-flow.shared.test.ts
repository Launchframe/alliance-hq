import { describe, expect, it } from "vitest";

import {
  currentGuidedStep,
  guidedFlowPrerequisitesBlocking,
  guidedFlowRosterBlocking,
  type GuidedFlowInput,
} from "@/lib/trains/guided-flow.shared";

const base: GuidedFlowInput = {
  hasConductor: true,
  vipNeeded: true,
  hasVip: true,
  locked: true,
};

describe("currentGuidedStep", () => {
  it("returns conductor when no conductor assigned", () => {
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

  it("blocks on roster before prerequisites when both are missing", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        locked: false,
        rosterDataRequired: true,
        rosterDataReady: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe("roster");
  });

  it("blocks on prerequisites when roster is ready but VS data missing", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        locked: false,
        rosterDataRequired: true,
        rosterDataReady: true,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe("prerequisites");
  });

  it("blocks on prerequisites when VS data required but missing", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe("prerequisites");
  });

  it("proceeds to conductor when VS data is ready", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        locked: false,
        vsDataRequired: true,
        vsDataReady: true,
      }),
    ).toBe("conductor");
  });

  it("proceeds to conductor when manual pick is available without scores", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
        conductorManualPickAvailable: true,
      }),
    ).toBe("conductor");
  });

  it("blocks prerequisites when VS data missing even without persisted week schedule", () => {
    expect(
      currentGuidedStep({
        ...base,
        hasConductor: false,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe("prerequisites");
  });

  it("does not block prerequisites when already locked", () => {
    expect(
      currentGuidedStep({
        ...base,
        locked: true,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe("done");
  });
});

describe("guidedFlowRosterBlocking", () => {
  it("is true when roster required, not ready, not locked", () => {
    expect(
      guidedFlowRosterBlocking({
        ...base,
        locked: false,
        rosterDataRequired: true,
        rosterDataReady: false,
      }),
    ).toBe(true);
  });

  it("is false when roster is ready", () => {
    expect(
      guidedFlowRosterBlocking({
        ...base,
        locked: false,
        rosterDataRequired: true,
        rosterDataReady: true,
      }),
    ).toBe(false);
  });
});

describe("guidedFlowPrerequisitesBlocking", () => {
  it("is true when VS data required, not ready, not locked", () => {
    expect(
      guidedFlowPrerequisitesBlocking({
        ...base,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe(true);
  });

  it("is false when data is ready", () => {
    expect(
      guidedFlowPrerequisitesBlocking({
        ...base,
        locked: false,
        vsDataRequired: true,
        vsDataReady: true,
      }),
    ).toBe(false);
  });

  it("is false when data is not required", () => {
    expect(
      guidedFlowPrerequisitesBlocking({
        ...base,
        locked: false,
        vsDataRequired: false,
        vsDataReady: false,
      }),
    ).toBe(false);
  });

  it("is false when locked even if scores are missing", () => {
    expect(
      guidedFlowPrerequisitesBlocking({
        ...base,
        locked: true,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe(false);
  });

  it("is false when manual conductor pick is available", () => {
    expect(
      guidedFlowPrerequisitesBlocking({
        ...base,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
        conductorManualPickAvailable: true,
      }),
    ).toBe(false);
  });
});
