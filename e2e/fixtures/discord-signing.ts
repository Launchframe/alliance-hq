import nacl from "tweetnacl";

export const discordTestKeyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(17));
export function discordTestFollowupPort() { return Number(process.env.PLAYWRIGHT_E2E_PORT ?? "5176") + 1; }
export function signedDiscordTestPayload(payload: unknown) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(timestamp + body), discordTestKeyPair.secretKey)).toString("hex");
  return { data: body, headers: { "Content-Type": "application/json", "x-signature-timestamp": timestamp, "x-signature-ed25519": signature } };
}
