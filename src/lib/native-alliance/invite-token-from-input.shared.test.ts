import { describe, expect, it } from "vitest";

import { extractHqInviteToken } from "@/lib/native-alliance/invite-token-from-input.shared";

describe("extractHqInviteToken", () => {
  it("extracts a token from a full invite URL", () => {
    expect(
      extractHqInviteToken(
        "https://hq.example/invite/abcDEF123_-xyz789012345678901234567890",
      ),
    ).toBe("abcDEF123_-xyz789012345678901234567890");
  });

  it("extracts a token from a path fragment", () => {
    expect(
      extractHqInviteToken("invite/abcDEF123_-xyz789012345678901234567890"),
    ).toBe("abcDEF123_-xyz789012345678901234567890");
  });

  it("accepts a bare long token", () => {
    expect(
      extractHqInviteToken("abcDEF123_-xyz789012345678901234567890"),
    ).toBe("abcDEF123_-xyz789012345678901234567890");
  });

  it("does not mistake current generated join codes for bare invite tokens", () => {
    expect(extractHqInviteToken("LFGO-0123456789ABCDEF")).toBeNull();
    expect(extractHqInviteToken("longalliancetag-0123456789abcdef")).toBeNull();
    expect(extractHqInviteToken("/invite/LFGO-0123456789ABCDEF")).toBe("LFGO-0123456789ABCDEF");
  });

  it("does not treat short join codes as invite tokens", () => {
    expect(extractHqInviteToken("AB12CD")).toBeNull();
    expect(extractHqInviteToken("JOIN-CODE-1")).toBeNull();
  });
});
