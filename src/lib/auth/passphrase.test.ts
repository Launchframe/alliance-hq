import { describe, expect, it } from "vitest";

import {
  generateHumanPassphrase,
  hashPassphrase,
  verifyPassphrase,
} from "./passphrase";

describe("passphrase", () => {
  it("generates readable hyphenated passphrases", () => {
    const value = generateHumanPassphrase();
    expect(value.split("-").length).toBeGreaterThanOrEqual(3);
  });

  it("verifies bcrypt hashes", async () => {
    const plain = generateHumanPassphrase();
    const hash = await hashPassphrase(plain);
    expect(await verifyPassphrase(plain, hash)).toBe(true);
    expect(await verifyPassphrase("wrong-passphrase", hash)).toBe(false);
  });
});
