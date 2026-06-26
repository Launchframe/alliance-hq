#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import nacl from "tweetnacl";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

const DEFAULT_BASE_URL = "http://localhost:5175";
const INTERACTIONS_PATH = "/api/webhooks/discord/interactions";

export function hexFromUint8Array(bytes) {
  return Buffer.from(bytes).toString("hex");
}

export function uint8ArrayFromHex(hex) {
  const trimmed = hex.trim().replace(/^["']|["']$/g, "");
  if (!/^[0-9a-f]+$/i.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new Error("Expected an even-length hex string.");
  }
  return new Uint8Array(Buffer.from(trimmed, "hex"));
}

export function createDiscordDevKeypair() {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: hexFromUint8Array(keyPair.publicKey),
    privateKey: hexFromUint8Array(keyPair.secretKey),
  };
}

export function signDiscordInteractionBody(rawBody, timestamp, privateKeyHex) {
  const secretKey = uint8ArrayFromHex(privateKeyHex);
  if (secretKey.length !== nacl.sign.secretKeyLength) {
    throw new Error(
      `DISCORD_DEV_PRIVATE_KEY must be ${nacl.sign.secretKeyLength} bytes (${nacl.sign.secretKeyLength * 2} hex chars).`,
    );
  }
  const message = Buffer.concat([
    Buffer.from(timestamp, "utf8"),
    Buffer.from(rawBody, "utf8"),
  ]);
  return hexFromUint8Array(nacl.sign.detached(message, secretKey));
}

export function buildDiscordInteractionHeaders(rawBody, privateKeyHex, now = Date.now()) {
  const timestamp = Math.floor(now / 1000).toString();
  return {
    "content-type": "application/json",
    "x-signature-ed25519": signDiscordInteractionBody(
      rawBody,
      timestamp,
      privateKeyHex,
    ),
    "x-signature-timestamp": timestamp,
  };
}

export function optionFromPair(pair) {
  const [name, ...rest] = pair.split("=");
  const value = rest.join("=");
  if (!name || value === "") {
    throw new Error(`Options must be name=value pairs. Received: ${pair}`);
  }
  if (value === "true" || value === "false") {
    return { name, type: 5, value: value === "true" };
  }
  // Only treat short, leading-zero-free digit runs as integers (e.g. `teams=2`).
  // Discord UIDs/snowflakes are long and must stay strings (type 3) so they are
  // not lossily coerced to a JS number.
  if (/^-?\d{1,9}$/.test(value) && !/^0\d+/.test(value)) {
    return { name, type: 4, value: Number.parseInt(value, 10) };
  }
  return { name, type: 3, value };
}

export function buildPingPayload() {
  return { type: 1 };
}

export function buildSlashPayload({
  command,
  options = [],
  guildId = "dev-guild-1",
  channelId = "dev-channel-1",
  userId = "dev-user-1",
  username = "DevUser",
  locale = "en-US",
}) {
  return {
    type: 2,
    guild_id: guildId,
    channel_id: channelId,
    locale,
    data: {
      name: command,
      options: options.map(optionFromPair),
    },
    member: {
      user: {
        id: userId,
        username,
      },
    },
  };
}

export function buildButtonPayload({
  customId,
  guildId = "dev-guild-1",
  channelId = "dev-channel-1",
  userId = "dev-user-1",
  username = "DevUser",
  locale = "en-US",
}) {
  return {
    type: 3,
    guild_id: guildId,
    channel_id: channelId,
    locale,
    data: {
      custom_id: customId,
    },
    member: {
      user: {
        id: userId,
        username,
      },
    },
  };
}

export function extractAuthorizeUrl(content) {
  if (typeof content !== "string") return null;
  const match = /https?:\/\/\S+\/discord\/authorize\?nonce=[A-Za-z0-9_-]+/u.exec(
    content,
  );
  return match?.[0] ?? null;
}

export function resolveInteractionsUrl({
  explicitUrl,
  baseUrl = process.env.NEXT_PUBLIC_APP_URL,
} = {}) {
  if (explicitUrl?.trim()) return explicitUrl.trim();
  const cleanBaseUrl = (baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  return `${cleanBaseUrl}${INTERACTIONS_PATH}`;
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg?.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return { flags, positional };
}

function commonPayloadContext(flags) {
  return {
    guildId:
      flags["guild-id"] ||
      process.env.DISCORD_DEV_GUILD_ID ||
      process.env.DISCORD_GUILD_ID ||
      "dev-guild-1",
    channelId:
      flags["channel-id"] ||
      process.env.DISCORD_DEV_CHANNEL_ID ||
      "dev-channel-1",
    userId:
      flags["user-id"] || process.env.DISCORD_DEV_USER_ID || "dev-user-1",
    username:
      flags.username || process.env.DISCORD_DEV_USERNAME || "DevUser",
    locale: flags.locale || process.env.DISCORD_DEV_LOCALE || "en-US",
  };
}

async function postSignedInteraction(payload, flags) {
  const privateKey = process.env.DISCORD_DEV_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error(
      "Set DISCORD_DEV_PRIVATE_KEY. Run `npm run discord:dev:keygen` for a local-only keypair.",
    );
  }

  const rawBody = JSON.stringify(payload);
  const url = resolveInteractionsUrl({
    explicitUrl: flags.url,
    baseUrl: flags["base-url"],
  });
  const response = await fetch(url, {
    method: "POST",
    headers: buildDiscordInteractionHeaders(rawBody, privateKey),
    body: rawBody,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { url, status: response.status, body };
}

function printUsage() {
  console.log(`Discord dev interaction helper

Usage:
  node scripts/discord/dev-interaction.mjs keygen
  node scripts/discord/dev-interaction.mjs ping [--base-url http://localhost:5175]
  node scripts/discord/dev-interaction.mjs slash <command> [name=value ...]
  node scripts/discord/dev-interaction.mjs button <custom_id>

Common flags:
  --url <full webhook URL>
  --base-url <app URL, default NEXT_PUBLIC_APP_URL or http://localhost:5175>
  --guild-id <guild id>       default DISCORD_DEV_GUILD_ID or dev-guild-1
  --channel-id <channel id>   default DISCORD_DEV_CHANNEL_ID or dev-channel-1
  --user-id <user id>         default DISCORD_DEV_USER_ID or dev-user-1
  --username <username>       default DISCORD_DEV_USERNAME or DevUser

Examples:
  npm run discord:dev:keygen
  npm run discord:dev:ping
  npm run discord:dev:slash -- link
  npm run discord:dev:slash -- link name=ColdStartOwner uid=1234567890121203
  npm run discord:dev:slash -- link-alliance tag=DEV
  npm run discord:dev:button -- link:walkthrough:done`);
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "keygen") {
    const keyPair = createDiscordDevKeypair();
    console.log("# Local Discord dev keys. Do not use for a real Discord app.");
    console.log(`DISCORD_PUBLIC_KEY=${keyPair.publicKey}`);
    console.log(`DISCORD_DEV_PRIVATE_KEY=${keyPair.privateKey}`);
    return;
  }

  const { flags, positional } = parseFlags(rest);
  let payload;

  if (command === "ping") {
    payload = buildPingPayload();
  } else if (command === "slash") {
    const [slashCommand, ...optionPairs] = positional;
    if (!slashCommand) throw new Error("slash requires a command name.");
    payload = buildSlashPayload({
      command: slashCommand,
      options: optionPairs,
      ...commonPayloadContext(flags),
    });
  } else if (command === "button") {
    const [customId] = positional;
    if (!customId) throw new Error("button requires a custom_id.");
    payload = buildButtonPayload({
      customId,
      ...commonPayloadContext(flags),
    });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  if (flags.json === "true") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const result = await postSignedInteraction(payload, flags);
  console.log(`POST ${result.url}`);
  console.log(`HTTP ${result.status}`);
  console.log(JSON.stringify(result.body, null, 2));

  const authorizeUrl = extractAuthorizeUrl(result.body?.data?.content);
  if (authorizeUrl) {
    console.log(`\nAuthorize URL:\n${authorizeUrl}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
