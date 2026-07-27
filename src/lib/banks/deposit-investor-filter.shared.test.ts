import { describe, expect, it } from "vitest";

import {
  depositSlipMatchesMyAlliance,
  filterDepositSlipsByInvestor,
  normalizeDepositAllianceTag,
  parseDepositFalloffInvestorFilterParam,
} from "@/lib/banks/deposit-investor-filter.shared";

const allianceId = "alliance_roar";

function slip(
  partial: Partial<{
    depositAllianceTag: string | null;
    depositAllianceId: string | null;
  }> = {},
) {
  return {
    depositAllianceTag: partial.depositAllianceTag ?? null,
    depositAllianceId: partial.depositAllianceId ?? null,
  };
}

describe("normalizeDepositAllianceTag", () => {
  it("trims and lowercases tags", () => {
    expect(normalizeDepositAllianceTag(" Roar ")).toBe("roar");
    expect(normalizeDepositAllianceTag("")).toBeNull();
    expect(normalizeDepositAllianceTag(null)).toBeNull();
  });
});

describe("depositSlipMatchesMyAlliance", () => {
  it("matches case-insensitive deposit tags", () => {
    expect(
      depositSlipMatchesMyAlliance(slip({ depositAllianceTag: "ROAR" }), {
        allianceId,
        allianceTag: "Roar",
      }),
    ).toBe(true);
  });

  it("matches linked depositAllianceId when tag is missing on slip", () => {
    expect(
      depositSlipMatchesMyAlliance(slip({ depositAllianceId: allianceId }), {
        allianceId,
        allianceTag: "Roar",
      }),
    ).toBe(true);
  });

  it("rejects partner investor tags", () => {
    expect(
      depositSlipMatchesMyAlliance(slip({ depositAllianceTag: "bOoM" }), {
        allianceId,
        allianceTag: "Roar",
      }),
    ).toBe(false);
  });
});

describe("filterDepositSlipsByInvestor", () => {
  const slips = [
    slip({ depositAllianceTag: "Roar" }),
    slip({ depositAllianceTag: "bOoM" }),
    slip({ depositAllianceId: allianceId }),
  ];

  it("returns all slips for the all filter", () => {
    expect(
      filterDepositSlipsByInvestor(slips, "all", {
        allianceId,
        allianceTag: "Roar",
      }),
    ).toHaveLength(3);
  });

  it("keeps only my-alliance slips for myAlliance filter", () => {
    expect(
      filterDepositSlipsByInvestor(slips, "myAlliance", {
        allianceId,
        allianceTag: "Roar",
      }),
    ).toHaveLength(2);
  });
});

describe("parseDepositFalloffInvestorFilterParam", () => {
  it("defaults to all", () => {
    expect(parseDepositFalloffInvestorFilterParam(null)).toBe("all");
    expect(parseDepositFalloffInvestorFilterParam("")).toBe("all");
    expect(parseDepositFalloffInvestorFilterParam("other")).toBe("all");
  });

  it("parses myAlliance", () => {
    expect(parseDepositFalloffInvestorFilterParam("myAlliance")).toBe("myAlliance");
  });
});
