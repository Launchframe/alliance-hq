import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), modal: vi.fn(), followup: vi.fn() }));
vi.mock("@/lib/time-off/discord-bot-handlers.server", () => ({ handleDiscordTimeOff: mocks.handle, openDiscordTimeOffModal: mocks.modal }));
vi.mock("@/lib/discord/interaction-followup.server", () => ({ editDiscordOriginalInteraction: mocks.followup, editDiscordOriginalInteractionWithFiles: vi.fn() }));

import { POST } from "./route";

const keys = nacl.sign.keyPair();
function request(payload: object, valid = true) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = nacl.sign.detached(Buffer.from(timestamp + body), keys.secretKey);
  if (!valid) signature[0] ^= 1;
  return new Request("http://localhost/api/webhooks/discord/interactions", {
    method: "POST", body,
    headers: { "x-signature-ed25519": Buffer.from(signature).toString("hex"), "x-signature-timestamp": timestamp },
  });
}
const payload = { type: 2, id: "interaction-a", application_id: "application-a", token: "test-interaction-token", guild_id: "guild-a", member: { user: { id: "user-a" } }, data: { name: "my-time-off" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_PUBLIC_KEY", Buffer.from(keys.publicKey).toString("hex"));
  vi.stubEnv("VERCEL", "");
  mocks.followup.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("signed Discord time-off webhook", () => {
  it("rejects invalid signatures before dispatching any time-off work", async () => {
    expect((await POST(request(payload, false))).status).toBe(401);
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it("acknowledges privately without awaiting slow management work", async () => {
    mocks.handle.mockReturnValue(new Promise(() => {}));
    const response = await POST(request(payload));
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.followup).not.toHaveBeenCalled();
  });

  it("delivers the deferred response privately with mentions suppressed", async () => {
    mocks.handle.mockResolvedValue({ content: "Time off saved.", components: [] });
    await POST(request(payload));
    await vi.waitFor(() => expect(mocks.followup).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, suppressMentions: true, content: "Time off saved." })));
  });

  it("dispatches modal submits and opens edit modals without a deferred modal response", async () => {
    mocks.handle.mockResolvedValue({ content: "Review time off" });
    const custom = "timeoff:abcdefghijklmnopqrstu:submit";
    expect(await (await POST(request({ ...payload, type: 5, data: { custom_id: custom, components: [] } }))).json()).toMatchObject({ type: 5 });
    mocks.modal.mockResolvedValue({ type: 9, data: { custom_id: custom, title: "Edit time off", components: [] } });
    expect(await (await POST(request({ ...payload, type: 3, data: { custom_id: "timeoff:abcdefghijklmnopqrstu:edit" } }))).json()).toMatchObject({ type: 9 });
  });
});
