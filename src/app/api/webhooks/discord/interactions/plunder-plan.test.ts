import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handle: vi.fn(), modal: vi.fn(), followup: vi.fn() }));
vi.mock("@/lib/plunder-plan/discord.server", () => ({ handlePlunderPlanDiscord: mocks.handle, openPlunderPlanModal: mocks.modal, plunderComponentNeedsModal: (id: string) => id.endsWith(":weekly") }));
vi.mock("@/lib/discord/interaction-followup.server", () => ({ editDiscordOriginalInteraction: mocks.followup, editDiscordOriginalInteractionWithFiles: vi.fn() }));
import { POST } from "./route";
const keys = nacl.sign.keyPair();
const payload = { type: 2, id: "123456789012345678", application_id: "123456789012345679", token: "test-only", data: { name: "plunder-plan" } };
function signed(body: object, valid = true) {
  const text = JSON.stringify(body), timestamp = String(Math.floor(Date.now() / 1000));
  const signature = nacl.sign.detached(Buffer.from(timestamp + text), keys.secretKey);
  if (!valid) signature[0] ^= 1;
  return new Request("http://localhost/api/webhooks/discord/interactions", { method: "POST", body: text, headers: { "x-signature-ed25519": Buffer.from(signature).toString("hex"), "x-signature-timestamp": timestamp } });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DISCORD_PUBLIC_KEY", Buffer.from(keys.publicKey).toString("hex")); vi.stubEnv("VERCEL", ""); mocks.followup.mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());
describe("Plunder Plan signed dispatch", () => {
  it("rejects forged requests before any work", async () => {
    expect((await POST(signed(payload, false))).status).toBe(401); expect(mocks.handle).not.toHaveBeenCalled();
  });
  it("defers privately and suppresses mentions in the response", async () => {
    mocks.handle.mockResolvedValue({ content: "Plunder Plan", components: [] });
    expect(await (await POST(signed(payload))).json()).toEqual({ type: 5, data: { flags: 64 } });
    await vi.waitFor(() => expect(mocks.followup).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, suppressMentions: true, content: "Plunder Plan" })));
  });
  it("opens a modal directly rather than deferring it", async () => {
    mocks.modal.mockResolvedValue({ type: 9, data: { title: "Plunder Plan" } });
    expect(await (await POST(signed({ ...payload, type: 3, data: { custom_id: "plunder:abcdefghijklmnopqrstu:weekly" } }))).json()).toMatchObject({ type: 9 });
    expect(mocks.handle).not.toHaveBeenCalled();
  });
});
