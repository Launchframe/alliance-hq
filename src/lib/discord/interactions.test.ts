import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import {
  buildCharacterPickerButtons,
  buildLinkIdentityConfirmButtons,
  buildVrConfirmButtons,
  discordComponentMessageResponse,
  discordMessageResponse,
  parseButtonCustomId,
  parseLinkSlashOptions,
  parseVrSlashLevel,
  verifyDiscordInteractionRequest,
} from "@/lib/discord/interactions";

describe("discord interactions", () => {
  it("verifies Discord ed25519 signatures on raw body bytes", () => {
    const keyPair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString("hex");
    const body = '{"type":2,"data":{"name":"link"}}';
    const timestamp = "1719062400";
    const message = Buffer.concat([
      Buffer.from(timestamp, "utf8"),
      Buffer.from(body, "utf8"),
    ]);
    const signature = Buffer.from(nacl.sign.detached(message, keyPair.secretKey)).toString(
      "hex",
    );

    expect(
      verifyDiscordInteractionRequest(body, signature, timestamp, publicKeyHex),
    ).toBe(true);
    expect(
      verifyDiscordInteractionRequest(
        Buffer.from(body, "utf8"),
        signature,
        timestamp,
        publicKeyHex,
      ),
    ).toBe(true);
    expect(
      verifyDiscordInteractionRequest(body, signature, timestamp, "0".repeat(64)),
    ).toBe(false);
  });
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
          options: [{ name: "replace", type: 5, value: true }],
        },
      }),
    ).toEqual({ replace: true });
    expect(parseLinkSlashOptions({ type: 2, data: { options: [] } })).toEqual({});
  });

  it("parses button custom ids", () => {
    expect(parseButtonCustomId("vr:confirm:7425:yes")).toEqual({
      kind: "vr_confirm",
      answer: "yes",
    });
    expect(parseButtonCustomId("weekly-pass:character:link-row-1")).toEqual({
      kind: "weekly_pass_character",
      linkId: "link-row-1",
    });
    expect(parseButtonCustomId("link:confirm:yes")).toEqual({
      kind: "link_confirm",
      answer: "yes",
    });
    expect(parseButtonCustomId("link:pick:member-1")).toEqual({
      kind: "link_pick",
      memberId: "member-1",
    });
    expect(parseButtonCustomId("link:start_over")).toEqual({
      kind: "link_start_over",
    });
    expect(parseButtonCustomId("train:pick:member-1:2026-06-20")).toEqual({
      kind: "train_pick",
      memberId: "member-1",
      date: "2026-06-20",
    });
    expect(parseButtonCustomId("train:confirm:member-1:2026-06-20:yes")).toEqual({
      kind: "train_confirm",
      memberId: "member-1",
      date: "2026-06-20",
      answer: "yes",
    });
    expect(parseButtonCustomId("other")).toBeNull();
  });

  it("builds yes/no buttons for link identity confirm", () => {
    const components = buildLinkIdentityConfirmButtons({ yes: "Yes", no: "No" });
    expect(components[0]?.components).toHaveLength(2);
    expect(components[0]?.components[0]?.custom_id).toBe("link:confirm:yes");
  });

  it("builds yes/no buttons for a proposed VR level", () => {
    const components = buildVrConfirmButtons(7425, { yes: "Yes", no: "No" });
    expect(components[0]?.components).toHaveLength(2);
    expect(components[0]?.components[0]?.custom_id).toBe("vr:confirm:7425:yes");
  });

  it("builds weekly-pass character picker buttons", () => {
    const components = buildCharacterPickerButtons(
      [{ linkId: "link-row-1", label: "Commander One" }],
      "weekly-pass",
    );
    expect(components[0]?.components[0]?.custom_id).toBe(
      "weekly-pass:character:link-row-1",
    );
  });

  it("defaults discord responses to non-ephemeral", () => {
    expect(discordMessageResponse("hello").data.flags).toBeUndefined();
  });

  it("uses UPDATE_MESSAGE for component replies", () => {
    expect(discordComponentMessageResponse("hello").type).toBe(7);
  });

  it("clears stale buttons when component reply omits new rows", () => {
    expect(discordComponentMessageResponse("confirmed").data.components).toEqual([]);
  });

  it("supports ephemeral link replies (UID privacy)", () => {
    expect(discordMessageResponse("linked", undefined, { ephemeral: true }).data.flags).toBe(
      64,
    );
  });
});
