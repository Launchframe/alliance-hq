import { describe, expect, it, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  limitResults: [] as unknown[][],
}));

function makeChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    set: () => chain,
    update: () => chain,
    insert: () => chain,
    values: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    limit: () => Promise.resolve(dbState.limitResults.shift() ?? []),
    then: <T>(
      onFulfilled: (value: undefined) => T,
      onRejected?: (reason: unknown) => T,
    ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => makeChain(),
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
    allianceMembers: { currentName: "currentName", allianceId: "allianceId", ashedMemberId: "ashedMemberId" },
    commanderStoreDonationReceipts: {},
    commanderStoreTipLinks: {
      code: "code",
      displayNameSnapshot: "displayNameSnapshot",
      ashedMemberId: "ashedMemberId",
      allianceId: "allianceId",
      ownerHqUserId: "ownerHqUserId",
      revokedAt: "revokedAt",
    },
    hqUsers: {},
    alliances: { id: "id", tag: "tag" },
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
  CommanderDonationError,
  loadPublicTipLink,
  resolvePublicTipStoreUrl,
  revokeActiveTipLinksForCommander,
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

describe("tip-jar ownership after unlink/reclaim", () => {
  beforeEach(() => {
    dbState.limitResults = [];
    delete process.env.LAST_WAR_STORE_LOGIN_TOKEN;
  });

  it("loadPublicTipLink returns null when the tip owner no longer holds the HQ link", async () => {
    // Ownership innerJoin yields no rows (unlink + reclaim by another HQ user).
    dbState.limitResults = [[]];
    await expect(loadPublicTipLink("orphan-code")).resolves.toBeNull();
  });

  it("resolvePublicTipStoreUrl 404s when ownership is missing", async () => {
    dbState.limitResults = [[]];
    await expect(resolvePublicTipStoreUrl("orphan-code")).rejects.toMatchObject({
      name: "CommanderDonationError",
      status: 404,
      code: "not_found",
    } satisfies Partial<CommanderDonationError>);
  });

  it("resolvePublicTipStoreUrl prefers the owner's linked gameUid", async () => {
    process.env.LAST_WAR_STORE_LOGIN_TOKEN = "test-token";
    dbState.limitResults = [
      [
        {
          code: "live-code",
          displayNameSnapshot: "Alice",
          ashedMemberId: "m-1",
          allianceId: "a1",
          ownerHqUserId: "hq-alice",
          ownerGameUid: "1111222233334444",
          allianceTag: "LFgo",
          memberName: "Alice",
        },
      ],
    ];
    const result = await resolvePublicTipStoreUrl("live-code");
    expect(result.url).toContain("uid=1111222233334444");
    expect(result.url).not.toContain("uid=9999888877776666");
  });

  it("revokeActiveTipLinksForCommander updates active tip rows", async () => {
    await expect(
      revokeActiveTipLinksForCommander({
        allianceId: "a1",
        ashedMemberId: "m-1",
      }),
    ).resolves.toBeUndefined();
  });
});
