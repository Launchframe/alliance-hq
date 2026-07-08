import { describe, expect, it } from "vitest";

import { parseButtonCustomId, parseLinkSlashOptions } from "@/lib/discord/interactions";

describe("link slash options", () => {
  it("parses replace boolean", () => {
    expect(
      parseLinkSlashOptions({
        type: 2,
        data: {
          options: [{ name: "replace", type: 5, value: true }],
        },
      }),
    ).toEqual({
      replace: true,
    });
  });
});

describe("unlink button custom ids", () => {
  it("parses link:unlink buttons", () => {
    expect(parseButtonCustomId("link:unlink:link-row-1")).toEqual({
      kind: "link_unlink",
      linkId: "link-row-1",
    });
  });
});
