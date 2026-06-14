#!/usr/bin/env node
/**
 * Register Discord slash commands for VR tracking.
 *
 *   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... npm run discord:register-commands
 */
import "dotenv/config";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!token || !applicationId) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID.");
  process.exit(1);
}

const commandBody = [
  {
    name: "link",
    description: "Link your Discord account to your in-game member",
    options: [
      {
        name: "name",
        description: "Your in-game name (exact copy from profile)",
        type: 3,
        required: true,
      },
      {
        name: "uid",
        description: "Your 12–16 digit UID ending in 1203",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "vr",
    description: "Report or bump your base viral resistance",
    options: [
      {
        name: "level",
        description: "Base VR (multiple of 250)",
        type: 4,
        min_value: 250,
        max_value: 12750,
        required: false,
      },
    ],
  },
  {
    name: "immunity",
    description: "Alias for /vr",
    options: [
      {
        name: "level",
        description: "Base VR (multiple of 250)",
        type: 4,
        min_value: 250,
        max_value: 12750,
        required: false,
      },
    ],
  },
];

const url = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commandBody),
});

const text = await response.text();
if (!response.ok) {
  console.error(`Failed (${response.status}): ${text}`);
  process.exit(1);
}

console.log(guildId ? `Registered guild commands on ${guildId}` : "Registered global commands");
console.log(text);
