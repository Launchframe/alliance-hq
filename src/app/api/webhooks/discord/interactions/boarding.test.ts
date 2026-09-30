import nacl from "tweetnacl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ready: vi.fn(), followup: vi.fn(), after: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/vr/service", () => ({ resolveAllianceForGuild: async () => "alliance" }));
vi.mock("@/lib/discord/i18n", async (original) => ({ ...await original<typeof import("@/lib/discord/i18n")>(), getDiscordBotLocale: async () => "en-US" }));
vi.mock("@/lib/trains/discord-bot-handlers.server", () => ({ handleDiscordTrainIsReady: mocks.ready }));
vi.mock("@/lib/discord/interaction-followup.server", () => ({ sendDiscordFollowup: mocks.followup, editDiscordOriginalInteraction: vi.fn(), editDiscordOriginalInteractionWithFiles: vi.fn() }));
import { POST } from "./route";
const keys = nacl.sign.keyPair();
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DISCORD_PUBLIC_KEY", Buffer.from(keys.publicKey).toString("hex")); vi.stubEnv("VERCEL", ""); mocks.followup.mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());
it("keeps the successful lock public and sends timing controls separately", async () => {
  mocks.ready.mockResolvedValue({ reply: "Public lock", boardingPrompt: { content: "Private countdown", components: [{ type: 1, components: [] }] } });
  const body = JSON.stringify({ type: 2, id: "123456789012345678", application_id: "app", token: "test-token", guild_id: "guild", member: { user: { id: "officer" } }, data: { name: "train-is-ready" } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(timestamp + body), keys.secretKey)).toString("hex");
  const response = await POST(new Request("http://localhost/api/webhooks/discord/interactions", { method: "POST", body, headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp } }));
  const data = await response.json();
  expect(data).toMatchObject({ type: 4, data: { content: "Public lock" } });
  expect((data.data.flags ?? 0) & 64).toBe(0);
  expect(data.data.components).toBeUndefined();
  expect(mocks.followup).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0]();
  await vi.waitFor(() => expect(mocks.followup).toHaveBeenCalledWith(expect.objectContaining({ content: "Private countdown", ephemeral: true })));
});
