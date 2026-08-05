import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import {
  pickMajorityLocale,
  resolveVsAnnouncementLocaleForAlliance,
} from "@/lib/vs-calculator/announcement-locale.server";

describe("pickMajorityLocale", () => {
  it("defaults to en-US when there are no rows", () => {
    expect(pickMajorityLocale([])).toBe("en-US");
  });

  it("picks the majority locale among the full pool when nobody is an officer", () => {
    const rows = [
      { allianceRank: null, locale: "pt-BR" },
      { allianceRank: 1, locale: "pt-BR" },
      { allianceRank: 2, locale: "en-US" },
    ];
    expect(pickMajorityLocale(rows)).toBe("pt-BR");
  });

  it("prefers officer (R4+) preferences over the general member pool", () => {
    const rows = [
      { allianceRank: 1, locale: "pt-BR" },
      { allianceRank: 2, locale: "pt-BR" },
      { allianceRank: 2, locale: "pt-BR" },
      { allianceRank: 4, locale: "en-US" },
      { allianceRank: 5, locale: "en-US" },
    ];
    // 3 pt-BR members vs 2 en-US officers — officers still win because they're
    // the preferred pool whenever any officer has an explicit preference.
    expect(pickMajorityLocale(rows)).toBe("en-US");
  });

  it("breaks ties toward en-US", () => {
    const rows = [
      { allianceRank: 4, locale: "en-US" },
      { allianceRank: 5, locale: "pt-BR" },
    ];
    expect(pickMajorityLocale(rows)).toBe("en-US");
  });

  it("treats any non pt-BR value as en-US", () => {
    const rows = [{ allianceRank: 4, locale: "fr-FR" }];
    expect(pickMajorityLocale(rows)).toBe("en-US");
  });
});

describe("resolveVsAnnouncementLocaleForAlliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries linked members and returns the majority locale", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { allianceRank: 4, locale: "pt-BR" },
                { allianceRank: 5, locale: "pt-BR" },
              ]),
            }),
          }),
        }),
      }),
    } as never);

    await expect(
      resolveVsAnnouncementLocaleForAlliance("alliance-1"),
    ).resolves.toBe("pt-BR");
  });

  it("defaults to en-US when nobody has linked prefs", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    } as never);

    await expect(
      resolveVsAnnouncementLocaleForAlliance("alliance-1"),
    ).resolves.toBe("en-US");
  });
});
