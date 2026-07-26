import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    hqMemberLinks: {
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      hqUserId: "hqUserId",
      gameUid: "gameUid",
    },
    discordMemberLinks: {
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      gameUid: "gameUid",
    },
    commanders: { id: "id", gameUid: "gameUid" },
    allianceMembers: {},
    commanderStoreDonationReceipts: {},
    commanderStoreTipLinks: {},
    hqUsers: {},
    alliances: {},
  },
}));

vi.mock("@/lib/members/commander-access.server", () => ({
  assertCommanderReadAccess: vi.fn(),
  loadAllianceCommander: vi.fn(),
  resolveCommanderSessionContext: vi.fn(),
  CommanderAccessError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermissionForAlliance: vi.fn(),
}));

import {
  buildLastWarStoreUrl,
  STORE_BRICK_GIFT_PERMISSION,
} from "@/lib/members/commander-donation.server";
import { buildStoreTipBadgeSvg } from "@/lib/members/store-tip-badge.shared";
import {
  commanderDonationStoreLaunchPath,
  publicStoreTipLaunchPath,
} from "@/lib/members/store-tip-launch.shared";

describe("STORE_BRICK_GIFT_PERMISSION", () => {
  it("is members:write at launch", () => {
    expect(STORE_BRICK_GIFT_PERMISSION).toBe("members:write");
  });
});

describe("buildLastWarStoreUrl", () => {
  beforeEach(() => {
    delete process.env.LAST_WAR_STORE_LOGIN_TOKEN;
  });

  it("returns null when login token env is unset", () => {
    expect(buildLastWarStoreUrl("123456789012")).toBeNull();
  });

  it("includes uid and platform when token is set", () => {
    process.env.LAST_WAR_STORE_LOGIN_TOKEN = "test-token";
    const url = buildLastWarStoreUrl("123456789012");
    expect(url).toContain("officeGoldBrickPaymentLoginServlet");
    expect(url).toContain("uid=123456789012");
    expect(url).toContain("website_platform=new_office");
    expect(url).toContain("loginToken=test-token");
  });
});

describe("store tip launch paths", () => {
  it("builds opaque HQ launch paths (clients must not fetch JSON store URLs)", () => {
    expect(publicStoreTipLaunchPath("abc/../x")).toBe(
      "/api/public/store-tip/abc%2F..%2Fx/launch",
    );
    expect(commanderDonationStoreLaunchPath("mem-1")).toBe(
      "/api/members/mem-1/donation-store",
    );
  });
});

describe("buildStoreTipBadgeSvg", () => {
  it("renders name and short URL without embedding a sample UID as the QR payload", () => {
    const uid = "9999888877776666";
    const svg = buildStoreTipBadgeSvg({
      headline: "Buy me bricks",
      commanderName: "Alpha",
      allianceTag: "LFgo",
      shortUrlDisplay: "hq.example/b/abc123",
      qrModules: [
        [true, false],
        [false, true],
      ],
    });
    expect(svg).toContain("Alpha");
    expect(svg).toContain("LFgo");
    expect(svg).toContain("hq.example/b/abc123");
    expect(svg).not.toContain(uid);
    expect(svg).toContain("<svg");
  });
});
