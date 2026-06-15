import { describe, expect, it } from "vitest";

import { buildPairingUrl, isPairingPurpose } from "@/lib/credential-pairing";
import {
  PairingError,
  pairingErrorStatus,
} from "@/lib/credential-pairing/types";

describe("isPairingPurpose", () => {
  it("accepts known purposes", () => {
    expect(isPairingPurpose("device_link")).toBe(true);
    expect(isPairingPurpose("authorized_access")).toBe(true);
  });

  it("rejects unknown purposes", () => {
    expect(isPairingPurpose("other")).toBe(false);
  });
});

describe("buildPairingUrl", () => {
  it("builds default-locale pair URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://alliance-hq.vercel.app";
    expect(buildPairingUrl("abc123")).toBe(
      "https://alliance-hq.vercel.app/pair?code=abc123",
    );
  });

  it("prefixes non-default locale", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://alliance-hq.vercel.app";
    expect(buildPairingUrl("abc123", "pt-BR")).toBe(
      "https://alliance-hq.vercel.app/pt-BR/pair?code=abc123",
    );
  });
});

describe("pairingErrorStatus", () => {
  it("maps known error codes to HTTP statuses", () => {
    expect(pairingErrorStatus(new PairingError("x", "NOT_CONNECTED"))).toBe(404);
    expect(pairingErrorStatus(new PairingError("x", "EXPIRED"))).toBe(410);
    expect(pairingErrorStatus(new PairingError("x", "TOKEN_EXPIRED"))).toBe(401);
    expect(pairingErrorStatus(new PairingError("x", "NOT_IMPLEMENTED"))).toBe(501);
  });
});
