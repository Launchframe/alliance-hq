import { describe, expect, it } from "vitest";

import { filterWalkthroughSteps } from "@/lib/trains/walkthrough-helpers";

describe("filterWalkthroughSteps", () => {
  const steps = [
    {
      id: "schedule",
      targetCandidates: ["trains-schedule-section"],
      required: true,
    },
    {
      id: "template",
      targetCandidates: ["trains-template-selector"],
      required: false,
    },
    {
      id: "spin-week",
      targetCandidates: ["trains-spin-week-btn"],
      skipIfMissingTarget: true,
    },
  ] as const;

  it("drops required steps when their anchor is missing", () => {
    expect(
      filterWalkthroughSteps(steps, new Set(["trains-template-selector"])),
    ).toEqual([steps[1]]);
  });

  it("keeps optional steps only when their anchor exists", () => {
    expect(
      filterWalkthroughSteps(
        steps,
        new Set(["trains-schedule-section", "trains-template-selector"]),
      ),
    ).toEqual([steps[0], steps[1]]);
  });

  it("drops skipIfMissingTarget steps when their anchor is missing", () => {
    expect(
      filterWalkthroughSteps(
        steps,
        new Set(["trains-schedule-section", "trains-template-selector"]),
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
      ),
    ).toEqual([...steps]);
  });
});
