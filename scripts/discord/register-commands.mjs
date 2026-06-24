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

const vrLevelOption = {
  name: "level",
  description: "Base VR (multiple of 250)",
  description_localizations: {
    "pt-BR": "VR base (múltiplo de 250)",
  },
  type: 4,
  min_value: 250,
  max_value: 12750,
  required: false,
};

const commandBody = [
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
      {
        name: "name",
        description:
          "Your in-game name. Copy it exactly from your in-game profile.",
        description_localizations: {
          "pt-BR":
            "Seu nome no jogo. Copie exatamente do perfil dentro do jogo.",
        },
        type: 3,
        required: true,
      },
      {
        name: "uid",
        description:
          "Your 12–16 digit player ID, ending in your server number.",
        description_localizations: {
          "pt-BR":
            "Seu ID de jogador com 12–16 dígitos, terminando no número do servidor.",
        },
        type: 3,
        required: true,
      },
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
    ],
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
    description: "Bump your base viral resistance (VR) when you level up.",
    description_localizations: {
      "pt-BR": "Atualize seu VR base quando subir de nível.",
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
    name: "link-alliance",
    description:
      "Register this Discord server for your alliance (owner or platform maintainer).",
    description_localizations: {
      "pt-BR":
        "Registre este servidor do Discord para sua aliança (dono ou mantenedor da plataforma).",
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
    name: "link-to-ashed-seat",
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
