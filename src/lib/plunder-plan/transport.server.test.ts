import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPlanMessage, verifyPlanChannel } from "./transport.server";

const guildId = "123456789012345678", channelId = "223456789012345678", discordUserId = "323456789012345678";
afterEach(() => vi.unstubAllGlobals());

describe("Plunder Plan Discord transport", () => {
  it("rejects a foreign guild channel before posting", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: channelId, guild_id: "other", type: 0 }));
    vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn();
    expect(await sendPlanMessage({ token: "test-only", nonce: "nonce", target: { channelId, guildId }, authorize })).toEqual({ status: "pending" });
    expect(authorize).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("validates identifiers without requesting arbitrary URLs", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await verifyPlanChannel(guildId, "../users/@me", "test-only")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks authorization after opening the DM and suppresses a revoked send", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: channelId })); vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn().mockResolvedValue(null);
    expect(await sendPlanMessage({ token: "test-only", nonce: "nonce", target: { discordUserId }, authorize })).toEqual({ status: "cancelled" });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(authorize).toHaveBeenCalledWith(channelId);
  });
  it("sends with stable nonce and no automatic mentions", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: channelId })).mockResolvedValueOnce(Response.json({ id: "423456789012345678" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await sendPlanMessage({ token: "test-only", nonce: "same-intent", target: { discordUserId }, authorize: async () => "Plan" })).toMatchObject({ status: "sent" });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ content: "Plan", nonce: "same-intent", enforce_nonce: true, allowed_mentions: { parse: [] } });
  });
  it("treats a timeout after POST as uncertain, not retryable success", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: channelId })).mockRejectedValueOnce(new Error("timeout")); vi.stubGlobal("fetch", fetcher);
    expect(await sendPlanMessage({ token: "test-only", nonce: "same-intent", target: { discordUserId }, authorize: async () => "Plan" })).toEqual({ status: "uncertain" });
  });
});
