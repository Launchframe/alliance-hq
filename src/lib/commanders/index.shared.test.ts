import { describe, expect, it } from "vitest";

import { commanderIndexRowMatchesHqLinkFilter } from "@/lib/commanders/index.shared";

describe("commanderIndexRowMatchesHqLinkFilter", () => {
  it("passes all rows when filter is all", () => {
    expect(
      commanderIndexRowMatchesHqLinkFilter({ hqLinked: true }, "all"),
    ).toBe(true);
    expect(
      commanderIndexRowMatchesHqLinkFilter({ hqLinked: false }, "all"),
    ).toBe(true);
  });

  it("filters linked and not linked", () => {
    expect(
      commanderIndexRowMatchesHqLinkFilter({ hqLinked: true }, "linked"),
    ).toBe(true);
    expect(
      commanderIndexRowMatchesHqLinkFilter({ hqLinked: false }, "linked"),
    ).toBe(false);
    expect(
      commanderIndexRowMatchesHqLinkFilter({ hqLinked: false }, "not_linked"),
    ).toBe(true);
    expect(
      commanderIndexRowMatchesHqLinkFilter({ hqLinked: true }, "not_linked"),
    ).toBe(false);
  });
});
