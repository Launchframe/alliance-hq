import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPair,
} from "./password.shared";

describe("validatePasswordPair", () => {
  it("accepts matching passwords at minimum length", () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(
      validatePasswordPair({ password, confirmPassword: password }),
    ).toBeNull();
  });

  it("rejects empty password", () => {
    expect(validatePasswordPair({ password: "" })).toBe("required");
  });

  it("rejects short password", () => {
    expect(validatePasswordPair({ password: "short" })).toBe("too_short");
  });

  it("rejects mismatched confirmation", () => {
    expect(
      validatePasswordPair({
        password: "password-one",
        confirmPassword: "password-two",
      }),
    ).toBe("mismatch");
  });
});
