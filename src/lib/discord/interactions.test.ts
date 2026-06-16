import { describe, expect, it } from "vitest";

import {
  buildVrConfirmButtons,
  parseButtonCustomId,
  parseLinkSlashOptions,
  parseVrSlashLevel,
} from "@/lib/discord/interactions";

describe("discord interactions", () => {
  it("parses optional slash level", () => {
    expect(parseVrSlashLevel({ type: 2, data: { options: [] } })).toBeUndefined();
    expect(
      parseVrSlashLevel({
        type: 2,
        data: { options: [{ name: "level", type: 4, value: 7500 }] },
      }),
    ).toBe(7500);
  });

  it("parses link slash options", () => {
    expect(
      parseLinkSlashOptions({
        type: 2,
        data: {
          options: [
            { name: "name", type: 3, value: "PlayerOne" },
            { name: "uid", type: 3, value: "1234567890121203" },
          ],
        },
      }),
    ).toEqual({ name: "PlayerOne", uid: "1234567890121203" });
  });

  it("parses button custom ids", () => {
    expect(parseButtonCustomId("vr:confirm:7425:yes")).toEqual({
      kind: "vr_confirm",
      answer: "yes",
    });
    expect(parseButtonCustomId("link:pick:member-1")).toEqual({
      kind: "link_pick",
      memberId: "member-1",
    });
    expect(parseButtonCustomId("link:start_over")).toEqual({
      kind: "link_start_over",
    });
    expect(parseButtonCustomId("other")).toBeNull();
  });

  it("builds yes/no buttons for a proposed VR level", () => {
    const components = buildVrConfirmButtons(7425, { yes: "Yes", no: "No" });
    expect(components[0]?.components).toHaveLength(2);
    expect(components[0]?.components[0]?.custom_id).toBe("vr:confirm:7425:yes");
  });
});
