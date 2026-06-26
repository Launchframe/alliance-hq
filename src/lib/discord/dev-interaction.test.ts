import { describe, expect, it } from "vitest";

import { verifyDiscordInteractionRequest } from "@/lib/discord/interactions";
import {
  buildDiscordInteractionHeaders,
  buildSlashPayload,
  createDiscordDevKeypair,
  extractAuthorizeUrl,
  optionFromPair,
  resolveInteractionsUrl,
} from "../../../scripts/discord/dev-interaction.mjs";

describe("discord dev interaction helper", () => {
  it("generates keys that sign payloads accepted by Discord verifier", () => {
    const keyPair = createDiscordDevKeypair();
    const rawBody = JSON.stringify({ type: 1 });
    const headers = buildDiscordInteractionHeaders(
      rawBody,
      keyPair.privateKey,
      1_719_062_400_000,
    );

    expect(
      verifyDiscordInteractionRequest(
        rawBody,
        headers["x-signature-ed25519"],
        headers["x-signature-timestamp"],
        keyPair.publicKey,
      ),
    ).toBe(true);
  });

  it("builds slash payload options with Discord option types", () => {
    expect(optionFromPair("name=ColdStartOwner")).toEqual({
      name: "name",
      type: 3,
      value: "ColdStartOwner",
    });
    expect(optionFromPair("replace=true")).toEqual({
      name: "replace",
      type: 5,
      value: true,
    });
    expect(optionFromPair("teams=2")).toEqual({
      name: "teams",
      type: 4,
      value: 2,
    });

    const buildSlash = buildSlashPayload as (args: {
      command: string;
      options?: string[];
    }) => { data: { options: unknown } };
    const slashOptions = buildSlash({
      command: "link",
      options: ["name=ColdStartOwner", "uid=1234567890121203"],
    }).data.options;
    expect(slashOptions).toEqual([
      { name: "name", type: 3, value: "ColdStartOwner" },
      { name: "uid", type: 3, value: "1234567890121203" },
    ]);
  });

  it("extracts authorize URLs from Discord response content", () => {
    expect(
      extractAuthorizeUrl(
        "Click this link:\nhttp://localhost:5175/discord/authorize?nonce=abc123",
      ),
    ).toBe("http://localhost:5175/discord/authorize?nonce=abc123");
  });

  it("resolves the local interactions URL by default", () => {
    expect(resolveInteractionsUrl({ baseUrl: "" })).toBe(
      "http://localhost:5175/api/webhooks/discord/interactions",
    );
    expect(resolveInteractionsUrl({ baseUrl: "https://example.test/" })).toBe(
      "https://example.test/api/webhooks/discord/interactions",
    );
  });
});
