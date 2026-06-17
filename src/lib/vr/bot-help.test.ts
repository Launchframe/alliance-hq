import { describe, expect, it } from "vitest";

import { parseButtonCustomId, parseLinkSlashOptions } from "@/lib/discord/interactions";

describe("link slash options", () => {
  it("parses replace boolean", () => {
    expect(
      parseLinkSlashOptions({
        type: 2,
        data: {
          options: [
            { name: "name", type: 3, value: "Hero" },
            { name: "uid", type: 3, value: "1234567890121203" },
            { name: "replace", type: 5, value: true },
          ],
        },
      }),
    ).toEqual({
      name: "Hero",
      uid: "1234567890121203",
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
