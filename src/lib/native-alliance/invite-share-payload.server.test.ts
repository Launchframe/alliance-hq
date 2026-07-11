import { describe, expect, it } from "vitest";

import {
  buildInviteLinkSharePayload,
  buildJoinCodeSharePayload,
} from "@/lib/native-alliance/invite-share-payload.server";

const LONG_TOKEN = "abcDEF123_-xyz789012345678901234567890";

describe("invite share payload builders", () => {
  it("builds claim code welcome URL and share message", () => {
    const payload = buildJoinCodeSharePayload({
      origin: "https://hq.example",
      allianceName: "LFgo",
      allianceTag: "LFgo",
      code: "LFGO-A1B2C3",
      variant: "claim_code",
    });
    expect(payload.welcomeUrl).toBe(
      "https://hq.example/welcome?tag=LFgo&code=LFGO-A1B2C3",
    );
    expect(payload.welcomeUrlRequiresAllianceTag).toBe(false);
    expect(payload.shareMessage).toContain(payload.welcomeUrl);
    expect(payload.shareMessage).toContain("claim your Commander");
  });

  it("builds multi-use join code welcome URL and share message", () => {
    const payload = buildJoinCodeSharePayload({
      origin: "https://hq.example/",
      allianceName: "LFgo",
      allianceTag: "LFgo",
      code: "LFGO-A1B2C3",
      variant: "join_code",
    });
    expect(payload.welcomeUrl).toBe(
      "https://hq.example/welcome?tag=LFgo&code=LFGO-A1B2C3",
    );
    expect(payload.welcomeUrlRequiresAllianceTag).toBe(false);
    expect(payload.shareMessage).toContain(payload.welcomeUrl);
    expect(payload.shareMessage).not.toContain("/join");
  });

  it("omits welcome URL and flags missing tag for join codes", () => {
    const payload = buildJoinCodeSharePayload({
      origin: "https://hq.example",
      allianceName: "LFgo",
      allianceTag: null,
      code: "LFGO-A1B2C3",
      variant: "join_code",
    });
    expect(payload.welcomeUrl).toBeNull();
    expect(payload.welcomeUrlRequiresAllianceTag).toBe(true);
    expect(payload.shareMessage).toContain("/join?code=LFGO-A1B2C3");
    expect(payload.shareMessage).not.toContain("tag=HQ");
  });

  it("builds invite link welcome URL from accept URL token", () => {
    const payload = buildInviteLinkSharePayload({
      origin: "https://hq.example",
      allianceName: "LFgo",
      inviteUrl: `https://hq.example/invite/${LONG_TOKEN}?next=%2Fmembers`,
      passphrase: "secret",
    });
    expect(payload.welcomeUrl).toBe(
      `https://hq.example/welcome?invite=${LONG_TOKEN}`,
    );
    expect(payload.shareMessage).toContain(payload.welcomeUrl);
    expect(payload.shareMessage).toContain("secret");
  });

  it("falls back to legacy invite URL when token cannot be extracted", () => {
    const legacyUrl = "https://hq.example/not-an-invite-page";
    const payload = buildInviteLinkSharePayload({
      origin: "https://hq.example",
      allianceName: "LFgo",
      inviteUrl: legacyUrl,
    });
    expect(payload.welcomeUrl).toBe(legacyUrl);
    expect(payload.shareMessage).toContain(legacyUrl);
  });
});
