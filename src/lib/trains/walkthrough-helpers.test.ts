import { describe, expect, it } from "vitest";

import {
  filterWalkthroughSteps,
  WALKTHROUGH_STEPS,
  type WalkthroughStepDefinition,
} from "@/lib/trains/walkthrough-helpers";

describe("filterWalkthroughSteps", () => {
  const steps: WalkthroughStepDefinition[] = [
    {
      id: "schedule",
      targetCandidates: ["trains-schedule-section"],
      required: true,
      dialogDesktop: "right",
      mode: "next",
      messageKey: "step1",
    },
    {
      id: "template",
      targetCandidates: ["trains-template-selector"],
      required: false,
      dialogDesktop: "left",
      mode: "next",
      messageKey: "step2",
    },
    {
      id: "spin-week",
      targetCandidates: ["trains-spin-week-btn"],
      skipIfMissingTarget: true,
      dialogDesktop: "right",
      mode: "next",
      messageKey: "step7",
    },
  ];

  const today = "2026-07-28";

  it("drops required steps when their anchor is missing", () => {
    expect(
      filterWalkthroughSteps(steps, new Set(["trains-template-selector"]), today),
    ).toEqual([steps[1]]);
  });

  it("keeps optional steps only when their anchor exists", () => {
    expect(
      filterWalkthroughSteps(
        steps,
        new Set(["trains-schedule-section", "trains-template-selector"]),
        today,
      ),
    ).toEqual([steps[0], steps[1]]);
  });

  it("drops skipIfMissingTarget steps when their anchor is missing", () => {
    expect(
      filterWalkthroughSteps(
        steps,
        new Set(["trains-schedule-section", "trains-template-selector"]),
        today,
      ),
    ).not.toContainEqual(steps[2]);
  });

  it("includes skipIfMissingTarget steps when their anchor exists", () => {
    expect(
      filterWalkthroughSteps(
        steps,
        new Set([
          "trains-schedule-section",
          "trains-template-selector",
          "trains-spin-week-btn",
        ]),
        today,
      ),
    ).toEqual([...steps]);
  });

  it("resolves dynamic today tile anchors for the day-long-press step", () => {
    const dayStep = WALKTHROUGH_STEPS.find((step) => step.id === "day-long-press");
    expect(dayStep).toBeDefined();
    const filtered = filterWalkthroughSteps(
      WALKTHROUGH_STEPS,
      new Set([`trains-week-day-${today}`]),
      today,
    );
    expect(filtered.some((step) => step.id === "day-long-press")).toBe(true);
  });
});
