import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sendPrivateWorkDigest } from "./work-transport.server";

afterEach(() => vi.unstubAllGlobals());
const input = () => ({ token: "test-token", discordUserId: "recipient", content: "Resumo do trabalho da equipe", nonce: "digest-stable", authorizeSend: vi.fn(async () => true) });

describe("private durable work delivery transport", () => {
  it("does not POST a message after reassignment or revocation during DM preparation", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "dm" }));
    vi.stubGlobal("fetch", fetcher);
    const args = input();
    args.authorizeSend.mockResolvedValue(false);
    expect(await sendPrivateWorkDigest(args)).toEqual({ status: "cancelled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses a private DM, a stable enforced nonce, and no mentions", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: "dm" })).mockResolvedValueOnce(Response.json({ id: "message" }));
    vi.stubGlobal("fetch", fetcher);
    const args = input();
    expect(await sendPrivateWorkDigest(args)).toEqual({ status: "sent", messageId: "message", channelId: "dm" });
    expect(args.authorizeSend).toHaveBeenCalledWith("dm");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ content: args.content, nonce: args.nonce, enforce_nonce: true, allowed_mentions: { parse: [] } });
    expect(fetcher.mock.calls[1][0]).toBe("https://discord.com/api/v10/channels/dm/messages");
  });
  it("retains an uncertain result after ambiguous external POST failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ id: "dm" })).mockRejectedValueOnce(new Error("network")));
    expect(await sendPrivateWorkDigest(input())).toEqual({ status: "uncertain" });
  });
  it("retains an uncertain result after a 5xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ id: "dm" })).mockResolvedValueOnce(new Response(null, { status: 502 })));
    expect(await sendPrivateWorkDigest(input())).toEqual({ status: "uncertain" });
  });
  it("retries a rejected DM without losing the HQ task", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })));
    expect(await sendPrivateWorkDigest(input())).toEqual({ status: "pending" });
  });
  it("retries rate limits known not to have accepted a message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ id: "dm" })).mockResolvedValueOnce(new Response(null, { status: 429 })));
    expect(await sendPrivateWorkDigest(input())).toEqual({ status: "pending" });
  });
});
