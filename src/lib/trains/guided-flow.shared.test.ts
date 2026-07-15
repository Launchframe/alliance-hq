import { describe, expect, it } from "vitest";

import {
  currentGuidedStep,
  guidedFlowPrerequisitesBlocking,
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

  it("does not block prerequisites when template not yet chosen", () => {
    expect(
      currentGuidedStep({
        ...base,
        schedulePersisted: false,
        hasConductor: false,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe("template");
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

describe("guidedFlowPrerequisitesBlocking", () => {
  it("is true when VS data required, not ready, template chosen, not locked", () => {
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

  it("is false when template not yet persisted", () => {
    expect(
      guidedFlowPrerequisitesBlocking({
        ...base,
        schedulePersisted: false,
        locked: false,
        vsDataRequired: true,
        vsDataReady: false,
      }),
    ).toBe(false);
  });
});
