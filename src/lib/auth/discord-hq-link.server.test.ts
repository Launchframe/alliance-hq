import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncDiscordHqLinkFromOAuthSignIn } from "@/lib/auth/discord-hq-link.server";
import { getDb } from "@/lib/db";
import { upsertDiscordHqLink } from "@/lib/vr/repository";

vi.mock("@/lib/vr/repository", () => ({
  upsertDiscordHqLink: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    discordHqLinks: {
      hqUserId: "hqUserId",
      discordUserId: "discordUserId",
    },
  },
}));

describe("syncDiscordHqLinkFromOAuthSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when discord or hq user id is blank", async () => {
    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: "  ",
      hqUserId: "hq-1",
    });
    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: "discord-1",
      hqUserId: "",
    });

    expect(getDb).not.toHaveBeenCalled();
    expect(upsertDiscordHqLink).not.toHaveBeenCalled();
  });

  it("clears stale HQ bindings then upserts discord_hq_links", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockReturnValue({ delete: deleteFn } as never);

    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: "  discord-1  ",
      hqUserId: "  hq-1  ",
    });

    expect(deleteFn).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(upsertDiscordHqLink).toHaveBeenCalledWith({
      discordUserId: "discord-1",
      hqUserId: "hq-1",
    });
  });
});
