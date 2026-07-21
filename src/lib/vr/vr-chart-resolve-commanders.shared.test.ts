import { describe, expect, it } from "vitest";

import {
  expandVrChartCommanderNameInputs,
  resolveVrChartCommanderNames,
} from "@/lib/vr/vr-chart-resolve-commanders.shared";

describe("resolveVrChartCommanderNames", () => {
  const candidates = [
    { commanderId: "cmd-alpha", memberName: "Alpha" },
    { commanderId: "cmd-bravo", memberName: "Bravo" },
    { commanderId: "cmd-viewer", memberName: "Viewer" },
  ];

  it("resolves exact commander names", () => {
    expect(
      resolveVrChartCommanderNames(["Alpha", "bravo"], candidates),
    ).toEqual({
      commanderIds: ["cmd-alpha", "cmd-bravo"],
      notFound: [],
      ambiguous: [],
    });
  });

  it("reports unknown names", () => {
    expect(resolveVrChartCommanderNames(["Missing"], candidates)).toEqual({
      commanderIds: [],
      notFound: ["Missing"],
      ambiguous: [],
    });
  });

  it("dedupes repeated names", () => {
    expect(resolveVrChartCommanderNames(["Alpha", "Alpha"], candidates)).toEqual({
      commanderIds: ["cmd-alpha"],
      notFound: [],
      ambiguous: [],
    });
  });
});

describe("expandVrChartCommanderNameInputs", () => {
  it("splits comma-separated tokens", () => {
    expect(expandVrChartCommanderNameInputs(["Alpha, Bravo", "Charlie"])).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });
});
