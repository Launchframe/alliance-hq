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

const DISCORD_DESCRIPTION_MAX = 100;

const vrLevelOption = {
  name: "level",
  description: "Institute building level (optional)",
  description_localizations: {
    "pt-BR": "Nível do edifício do instituto (opcional)",
  },
  type: 4,
  min_value: 1,
  max_value: 60,
  required: false,
};

const thpOptions = [
  {
    name: "total",
    description: "Total hero power from Power Details (optional)",
    description_localizations: {
      "pt-BR": "Poder total de heróis na tela Power Details (opcional)",
    },
    type: 4,
    min_value: 1,
    required: false,
  },
  {
    name: "screenshot",
    description: "Screenshot of your Power Details screen (optional)",
    description_localizations: {
      "pt-BR": "Captura da tela Power Details (opcional)",
    },
    type: 11,
    required: false,
  },
];

const killsOptions = [
  {
    name: "total",
    description: "Your total kill count from Last War",
    description_localizations: {
      "pt-BR": "Seu total de kills no Last War",
    },
    type: 4,
    min_value: 1,
    required: true,
  },
];

const commanderLinkOptions = [
  {
    name: "replace",
    description:
      "Replace all your linked commanders with this one (switch main character).",
    description_localizations: {
      "pt-BR":
        "Substitui todos os comandantes vinculados por este (trocar personagem principal).",
    },
    type: 5,
    required: false,
  },
];

/** Discord slash-command choices allow at most 25 entries. */
const translationLanguageChoices = [
  { name: "English", value: "en" },
  { name: "Português", value: "pt" },
  { name: "Español", value: "es" },
  { name: "Français", value: "fr" },
  { name: "Deutsch", value: "de" },
  { name: "Italiano", value: "it" },
  { name: "Nederlands", value: "nl" },
  { name: "Polski", value: "pl" },
  { name: "Русский", value: "ru" },
  { name: "Українська", value: "uk" },
  { name: "Türkçe", value: "tr" },
  { name: "العربية", value: "ar" },
  { name: "한국어", value: "ko" },
  { name: "日本語", value: "ja" },
  { name: "中文（简体）", value: "zh-CN" },
  { name: "中文（繁體）", value: "zh-TW" },
  { name: "Tiếng Việt", value: "vi" },
  { name: "ไทย", value: "th" },
  { name: "Bahasa Indonesia", value: "id" },
  { name: "Bahasa Melayu", value: "ms" },
  { name: "Filipino", value: "tl" },
  { name: "हिन्दी", value: "hi" },
  { name: "Ελληνικά", value: "el" },
  { name: "Magyar", value: "hu" },
];

const commandBody = [
  {
    // Message context menu (Apps → Translate); context menus take no description.
    name: "Translate",
    type: 3,
    name_localizations: {
      "pt-BR": "Traduzir",
    },
  },
  {
    name: "translation-language",
    description: "Choose the language Apps → Translate uses for you.",
    description_localizations: {
      "pt-BR": "Escolha o idioma usado em Apps → Traduzir para você.",
    },
    options: [
      {
        name: "language",
        description: "Your translation language",
        description_localizations: {
          "pt-BR": "Seu idioma de tradução",
        },
        type: 3,
        required: true,
        choices: translationLanguageChoices,
      },
    ],
  },
  {
    name: "set-translation",
    description: "Turn Apps → Translate on or off for this alliance (owner only).",
    description_localizations: {
      "pt-BR": "Ativa ou desativa Apps → Traduzir para esta aliança (somente dono).",
    },
    options: [
      {
        name: "enabled",
        description: "Turn message translation on or off.",
        description_localizations: {
          "pt-BR": "Ativa ou desativa a tradução de mensagens.",
        },
        type: 5,
        required: true,
      },
    ],
  },
  {
    name: "link",
    description: "Link your Discord account to Alliance HQ",
    description_localizations: {
      "pt-BR": "Vincule sua conta do Discord ao Alliance HQ",
    },
  },
  {
    name: "link-commander",
    description: "Link a Last War commander (in-game character) to your Discord account",
    description_localizations: {
      "pt-BR": "Vincule um comandante do Last War (personagem) à sua conta do Discord",
    },
    options: [
      ...commanderLinkOptions,
    ],
  },
  {
    name: "link-last-war-profile",
    description: "Alias for /link-commander — link your Last War profile",
    description_localizations: {
      "pt-BR": "Atalho para /link-commander — vincule seu perfil do Last War",
    },
    options: [...commanderLinkOptions],
  },
  {
    name: "help",
    description: "Show what to do next based on your setup progress",
    description_localizations: {
      "pt-BR": "Mostra o próximo passo conforme seu progresso de configuração",
    },
  },
  {
    name: "unlink",
    description: "Remove a linked in-game character from your Discord account",
    description_localizations: {
      "pt-BR": "Remove um personagem vinculado da sua conta do Discord",
    },
    options: [
      {
        name: "name",
        description: "Character name to unlink (optional if you have several).",
        description_localizations: {
          "pt-BR":
            "Nome do personagem a desvincular (opcional se você tiver vários).",
        },
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "vr",
    description: "Bump your institute level when you upgrade your building.",
    description_localizations: {
      "pt-BR": "Atualize seu nível do instituto quando subir o edifício.",
    },
    options: [vrLevelOption],
  },
  {
    name: "immunity",
    description: "Alias for /vr",
    description_localizations: {
      "pt-BR": "Atalho para /vr",
    },
    options: [vrLevelOption],
  },
  {
    name: "institute",
    description: "Alias for /vr",
    description_localizations: {
      "pt-BR": "Atalho para /vr",
    },
    options: [vrLevelOption],
  },
  {
    name: "thp",
    description: "Report your total hero power from Power Details.",
    description_localizations: {
      "pt-BR": "Informe seu poder total de heróis (Power Details).",
    },
    options: thpOptions,
  },
  {
    name: "hero-power",
    description: "Alias for /thp",
    description_localizations: {
      "pt-BR": "Atalho para /thp",
    },
    options: thpOptions,
  },
  {
    name: "kills",
    description: "Report your total kill count.",
    description_localizations: {
      "pt-BR": "Informe seu total de kills.",
    },
    options: killsOptions,
  },
  {
    name: "weekly-pass",
    description: "Toggle your weekly pass (+250 VR boost for strategy reports).",
    description_localizations: {
      "pt-BR":
        "Ative ou desative seu passe semanal (+250 VR em relatórios estratégicos).",
    },
    options: [
      {
        name: "active",
        description: "Turn the weekly pass on or off.",
        description_localizations: {
          "pt-BR": "Ative ou desative o passe semanal.",
        },
        type: 5,
        required: true,
      },
    ],
  },
  {
    name: "link-alliance",
    description:
      "Register this Discord server for your alliance (R5 owner, R4+ officer, or maintainer).",
    description_localizations: {
      "pt-BR":
        "Registre este servidor Discord para sua aliança (R5, R4+ ou mantenedor).",
    },
    options: [
      {
        name: "tag",
        description: "Alliance tag on ashed.online (for example LFgo).",
        description_localizations: {
          "pt-BR": "Tag da aliança no ashed.online (por exemplo LFgo).",
        },
        type: 3,
        required: true,
      },
      {
        name: "name",
        description:
          "Alliance display name — only if multiple alliances share the same tag.",
        description_localizations: {
          "pt-BR":
            "Nome da aliança — somente se várias alianças usarem a mesma tag.",
        },
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "set-vr-report-channel",
    description: "Set this channel for nightly VR standings (owner only).",
    description_localizations: {
      "pt-BR":
        "Define este canal para o relatório noturno de VR (somente dono).",
    },
  },
  {
    name: "vr-report",
    description: "Officer report: top-25 VR standings or takedown teams.",
    description_localizations: {
      "pt-BR":
        "Relatório de oficial: top 25 VR ou equipes de takedown.",
    },
    options: [
      {
        name: "teams",
        description: "Number of takedown teams (5 players each). Omit for top-25 list.",
        description_localizations: {
          "pt-BR":
            "Número de equipes de takedown (5 jogadores cada). Omita para o top 25.",
        },
        type: 4,
        min_value: 1,
        max_value: 5,
        required: false,
      },
    ],
  },
  {
    name: "takedown-teams",
    description: "Alias for /vr-report with teams option.",
    description_localizations: {
      "pt-BR": "Atalho para /vr-report com opção de equipes.",
    },
    options: [
      {
        name: "teams",
        description: "Number of takedown teams (5 players each).",
        description_localizations: {
          "pt-BR": "Número de equipes de takedown (5 jogadores cada).",
        },
        type: 4,
        min_value: 1,
        max_value: 5,
        required: false,
      },
    ],
  },
  {
    name: "what-is-my-vr",
    description: "Show your current institute level (channel-visible).",
    description_localizations: {
      "pt-BR": "Mostra seu nível atual do instituto (visível no canal).",
    },
  },
  {
    name: "what-is-my-thp",
    description: "Show your current total hero power (channel-visible).",
    description_localizations: {
      "pt-BR": "Mostra seu poder total de heróis atual (visível no canal).",
    },
  },
  {
    name: "what-is-my-kill-count",
    description: "Show your current total kill count (channel-visible).",
    description_localizations: {
      "pt-BR": "Mostra seu total de kills atual (visível no canal).",
    },
  },
  {
    name: "link-ashed",
    description: "Connect your Ashed seat so the bot can read your alliance roster (owner only).",
    description_localizations: {
      "pt-BR":
        "Conecte seu assento Ashed para o bot ler o roster (somente dono).",
    },
    options: [
      {
        name: "tag",
        description: "Alliance tag on ashed.online (for example LFgo).",
        description_localizations: {
          "pt-BR": "Tag da aliança no ashed.online (por exemplo LFgo).",
        },
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "set-train-channel",
    description: "Set this channel for train conductor announcements (owner only).",
    description_localizations: {
      "pt-BR":
        "Define este canal para anúncios do trem (somente dono).",
    },
  },
  {
    name: "set-seasonal-events-channel",
    description: "Set this channel for seasonal event announcements — bank captures, etc. (owner only).",
    description_localizations: {
      "pt-BR":
        "Define este canal para anúncios de eventos sazonais — capturas de bancos, etc. (somente dono).",
    },
  },
  {
    name: "set-regular-events-channel",
    description: "Set this channel for regular event announcements (owner only).",
    description_localizations: {
      "pt-BR":
        "Define este canal para anúncios de eventos regulares (somente dono).",
    },
  },
  {
    name: "set-banking-channel",
    description: "Set this channel for banking partner notifications — protection timers, etc. (owner only).",
    description_localizations: {
      "pt-BR":
        "Define este canal para notificações de parceiros bancários — timers de proteção, etc. (somente dono).",
    },
  },
  {
    name: "who-is-conductor",
    description: "Show today's train conductor (and VIP if set).",
    description_localizations: {
      "pt-BR": "Mostra o condutor do trem de hoje (e VIP, se houver).",
    },
    options: [
      {
        name: "date",
        description: "Server calendar date (YYYY-MM-DD). Defaults to today.",
        description_localizations: {
          "pt-BR": "Data do calendário do servidor (AAAA-MM-DD). Padrão: hoje.",
        },
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "set-conductor",
    description: "Officer: draft a conductor for today (confirm before lock).",
    description_localizations: {
      "pt-BR":
        "Oficial: rascunho do condutor de hoje (confirme antes de travar).",
    },
    options: [
      {
        name: "name",
        description: "Member name from your alliance roster.",
        description_localizations: {
          "pt-BR": "Nome do membro no roster da aliança.",
        },
        type: 3,
        required: true,
      },
      {
        name: "date",
        description: "Server calendar date (YYYY-MM-DD). Defaults to today.",
        description_localizations: {
          "pt-BR": "Data do calendário do servidor (AAAA-MM-DD). Padrão: hoje.",
        },
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "train-is-ready",
    description: "Officer: lock today's conductor and announce in the train channel.",
    description_localizations: {
      "pt-BR":
        "Oficial: trava o condutor de hoje e anuncia no canal do trem.",
    },
    options: [
      {
        name: "date",
        description: "Server calendar date (YYYY-MM-DD). Defaults to today.",
        description_localizations: {
          "pt-BR": "Data do calendário do servidor (AAAA-MM-DD). Padrão: hoje.",
        },
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "language",
    description: "Choose bot reply language.",
    description_localizations: {
      "pt-BR": "Escolha o idioma das respostas do bot.",
    },
    options: [
      {
        name: "locale",
        description: "Bot language",
        description_localizations: {
          "pt-BR": "Idioma do bot",
        },
        type: 3,
        required: true,
        choices: [
          { name: "English", value: "English" },
          { name: "Português (Brasil)", value: "Português" },
        ],
      },
    ],
  },
  {
    name: "linguagem",
    description: "Alias for /language",
    description_localizations: {
      "pt-BR": "Atalho para /language",
    },
    options: [
      {
        name: "locale",
        description: "Bot language",
        description_localizations: {
          "pt-BR": "Idioma do bot",
        },
        type: 3,
        required: true,
        choices: [
          { name: "English", value: "English" },
          { name: "Português (Brasil)", value: "Português" },
        ],
      },
    ],
  },
  // ----- War Leader Support ------------------------------------------------
  {
    name: "switch-profession",
    description: "View or switch your profession: Engineer or War Leader.",
    description_localizations: {
      "pt-BR": "Veja ou troque sua profissão: Engenheiro ou Líder de Guerra.",
    },
  },
  {
    name: "my-engineers",
    description: "War Leaders: view your assigned Engineers and coverage.",
    description_localizations: {
      "pt-BR": "Líderes de Guerra: veja seus Engenheiros e cobertura.",
    },
  },
  {
    name: "set-profession-channel",
    description: "Register this channel for profession table announcements.",
    description_localizations: {
      "pt-BR": "Registre este canal para anúncios da tabela de profissões.",
    },
  },
];

/** @param {unknown} commands */
function validateDiscordCommandDescriptions(commands) {
  /** @type {string[]} */
  const problems = [];

  /** @param {string} path @param {string | undefined} value */
  function check(path, value) {
    if (value == null) return;
    const len = value.length;
    if (len < 1 || len > DISCORD_DESCRIPTION_MAX) {
      problems.push(`${path} (${len} chars): ${JSON.stringify(value)}`);
    }
  }

  /** @param {Record<string, unknown>} cmd @param {string} cmdPath */
  function walkCommand(cmd, cmdPath) {
    check(`${cmdPath}.description`, /** @type {string | undefined} */ (cmd.description));
    const locs = /** @type {Record<string, string> | undefined} */ (
      cmd.description_localizations
    );
    if (locs) {
      for (const [locale, text] of Object.entries(locs)) {
        check(`${cmdPath}.description_localizations.${locale}`, text);
      }
    }
    const options = /** @type {Record<string, unknown>[] | undefined} */ (cmd.options);
    if (options) {
      for (const [index, option] of options.entries()) {
        const optionPath = `${cmdPath}.options[${index}].${option.name ?? index}`;
        check(`${optionPath}.description`, /** @type {string | undefined} */ (option.description));
        const optionLocs = /** @type {Record<string, string> | undefined} */ (
          option.description_localizations
        );
        if (optionLocs) {
          for (const [locale, text] of Object.entries(optionLocs)) {
            check(`${optionPath}.description_localizations.${locale}`, text);
          }
        }
      }
    }
  }

  for (const [index, command] of /** @type {Record<string, unknown>[]} */ (commands).entries()) {
    walkCommand(command, `commands[${index}].${command.name ?? index}`);
  }

  if (problems.length > 0) {
    console.error("Discord command descriptions must be 1–100 characters:");
    for (const line of problems) console.error(`  - ${line}`);
    process.exit(1);
  }
}

validateDiscordCommandDescriptions(commandBody);

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
