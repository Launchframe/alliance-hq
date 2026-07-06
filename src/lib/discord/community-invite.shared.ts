import { discordServerLink } from "@/components/i18n/richText";

const DEFAULT_DISCORD_INVITE_URL = "https://discord.gg/pur2Uah2s";

export function resolveDiscordInviteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim() || DEFAULT_DISCORD_INVITE_URL
  );
}

export { discordServerLink };
