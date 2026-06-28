import { describe, expect, it } from "vitest";

import { ROLE_IDS } from "@/lib/rbac/constants";
import {
  buildTestMatrixAccounts,
  findTestMatrixAccount,
  TEST_MATRIX_ALLIANCES,
  TEST_MATRIX_PLATFORM_MAINTAINER_EMAIL,
  TEST_MATRIX_ROLES,
  testMatrixEmail,
} from "@/lib/dev/test-matrix";

describe("test-matrix registry", () => {
  const accounts = buildTestMatrixAccounts();
  const roleCount = Object.keys(ROLE_IDS).length;

  it("derives roles from ROLE_IDS so it auto-extends", () => {
    expect(TEST_MATRIX_ROLES).toEqual(Object.keys(ROLE_IDS));
  });

  it("covers every role × alliance × ashed flag plus one maintainer", () => {
    const expected = TEST_MATRIX_ALLIANCES.length * roleCount * 2 + 1;
    expect(accounts).toHaveLength(expected);
    expect(
      accounts.filter((a) => a.platformMaintainer),
    ).toHaveLength(1);
  });

  it("seeds each role both with and without Ashed in each alliance", () => {
    for (const alliance of TEST_MATRIX_ALLIANCES) {
      for (const role of TEST_MATRIX_ROLES) {
        const matches = accounts.filter(
          (a) => a.allianceKey === alliance.key && a.role === role,
        );
        expect(matches.map((m) => m.ashed).sort()).toEqual([false, true]);
      }
    }
  });

  it("only the ashed-flagged accounts carry a stable ashedUserId", () => {
    for (const account of accounts) {
      if (account.ashed) {
        expect(account.ashedUserId).toBe(`test-matrix-ashed:${account.email}`);
      } else {
        expect(account.ashedUserId).toBeNull();
      }
    }
  });

  it("builds deterministic, unique emails", () => {
    const emails = accounts.map((a) => a.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(
      testMatrixEmail({ allianceKey: "ashed", role: "owner", ashed: true }),
    ).toBe("test-matrix+tmash-owner-ashed@frontline.gay");
    expect(
      testMatrixEmail({ allianceKey: "native", role: "member", ashed: false }),
    ).toBe("test-matrix+tmnat-member-noashed@frontline.gay");
  });

  it("native-mode accounts mirror the native alliance", () => {
    const nativeAccounts = accounts.filter((a) => a.mode === "native");
    expect(nativeAccounts.length).toBe(roleCount * 2);
    expect(nativeAccounts.every((a) => a.allianceKey === "native")).toBe(true);
  });

  it("resolves accounts case-insensitively by email", () => {
    expect(
      findTestMatrixAccount(TEST_MATRIX_PLATFORM_MAINTAINER_EMAIL.toUpperCase())
        ?.platformMaintainer,
    ).toBe(true);
    expect(findTestMatrixAccount("nobody@example.com")).toBeNull();
  });
});
