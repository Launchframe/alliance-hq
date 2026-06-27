import type { DiscordBotLocale } from "@/lib/discord/i18n";

export const DISCORD_BOT_GUIDE_ROLE_SLUGS = [
  "r5",
  "r4",
  "member",
  "link-only",
] as const;

export type DiscordBotGuideRoleSlug =
  (typeof DISCORD_BOT_GUIDE_ROLE_SLUGS)[number];

export const DISCORD_BOT_GUIDE_TROUBLESHOOTING_IDS = [
  "copyNameUid",
  "nameMismatch",
  "rosterMiss",
  "guildNotRegistered",
  "memberTaken",
  "notOfficer",
  "wrongServer",
] as const;

export type DiscordBotGuideTroubleshootingId =
  (typeof DISCORD_BOT_GUIDE_TROUBLESHOOTING_IDS)[number];

export type DiscordBotGuideStepDef = {
  id?: string;
  optional?: boolean;
  showCommand?: boolean;
  showTip?: boolean;
  troubleshootingIds?: DiscordBotGuideTroubleshootingId[];
  screenshotKey?: string;
};

export const DISCORD_BOT_GUIDE_STEPS: Record<string, DiscordBotGuideStepDef> = {
  "link-self": {
    showCommand: true,
    showTip: true,
    troubleshootingIds: [
      "copyNameUid",
      "nameMismatch",
      "rosterMiss",
      "memberTaken",
      "wrongServer",
    ],
  },
  "register-guild": {
    showCommand: true,
    troubleshootingIds: ["guildNotRegistered"],
  },
  "optional-ashed": {
    optional: true,
    showCommand: true,
  },
  "vr-channel": {
    showCommand: true,
  },
  "train-channel": {
    showCommand: true,
  },
  "tell-members": {},
  "server-prereq": {
    troubleshootingIds: ["guildNotRegistered"],
  },
  "vr-reports": {
    showCommand: true,
    troubleshootingIds: ["notOfficer"],
  },
  "train-ops": {
    showCommand: true,
    troubleshootingIds: ["notOfficer"],
  },
  "help-members": {},
  "report-vr": {
    showCommand: true,
  },
  "check-conductor": {
    showCommand: true,
  },
  language: {
    showCommand: true,
  },
  "after-link": {},
};

export const DISCORD_BOT_GUIDE_ROLE_STEPS: Record<
  DiscordBotGuideRoleSlug,
  string[]
> = {
  r5: [
    "link-self",
    "register-guild",
    "optional-ashed",
    "vr-channel",
    "train-channel",
    "tell-members",
  ],
  r4: [
    "server-prereq",
    "link-self",
    "vr-reports",
    "train-ops",
    "help-members",
  ],
  member: ["link-self", "report-vr", "check-conductor", "language"],
  "link-only": ["link-self", "after-link"],
};

export const DISCORD_BOT_GUIDE_SCREENSHOTS: Record<string, string> = {
  copyNameUid: "/guides/discord-bot/copy-name-uid.png",
};

export function isDiscordBotGuideRoleSlug(
  value: string,
): value is DiscordBotGuideRoleSlug {
  return (DISCORD_BOT_GUIDE_ROLE_SLUGS as readonly string[]).includes(value);
}

export function stepSlugToMessageKey(slug: string): string {
  return slug.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function getDiscordBotGuideStep(
  stepSlug: string,
): DiscordBotGuideStepDef | null {
  return DISCORD_BOT_GUIDE_STEPS[stepSlug] ?? null;
}

export function isStepInRole(
  role: DiscordBotGuideRoleSlug,
  stepSlug: string,
): boolean {
  return DISCORD_BOT_GUIDE_ROLE_STEPS[role].includes(stepSlug);
}

export function buildDiscordBotGuidePath(
  locale: DiscordBotLocale,
  options?: { role?: DiscordBotGuideRoleSlug; step?: string },
): string {
  const localePrefix = locale === "en-US" ? "" : `/${locale}`;
  let path = `${localePrefix}/guides/discord-bot`;
  if (options?.role) {
    path += `/${options.role}`;
    if (options?.step) {
      path += `/${options.step}`;
    }
  }
  return path;
}

/** Maps context-aware /help message keys to a guide role path. */
export function helpMessageKeyToGuideRole(
  key: string,
): DiscordBotGuideRoleSlug | undefined {
  switch (key) {
    case "help.linkCommander":
      return "link-only";
    case "help.memberReady":
    case "help.memberReadyMulti":
      return "member";
    case "help.ownerReady":
    case "help.ownerReadyMulti":
    case "help.setupOwnerLinkHq":
    case "help.setupOwnerAshedSeat":
    case "help.setupLinkAlliance":
      return "r5";
    default:
      return undefined;
  }
}
