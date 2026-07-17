import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

import {
  createDiscordTranslator,
  getDiscordBotLocale,
  parseLanguageChoice,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import {
  downloadDiscordAttachment,
  parseResolvedAttachment,
} from "@/lib/discord/attachments";
import { editDiscordOriginalInteraction, editDiscordOriginalInteractionWithFiles } from "@/lib/discord/interaction-followup.server";
import {
  DISCORD_PING_RESPONSE,
  buildCharacterPickerButtons,
  buildLinkFailureButtons,
  buildLinkFuzzyButtons,
  buildLinkIdentityConfirmButtons,
  buildThpConfirmButtons,
  buildKillsConfirmButtons,
  buildTrainConfirmButtons,
  buildTrainPickButtons,
  buildVrConfirmButtons,
  buildWalkthroughDoneButton,
  discordComponentMessageResponse,
  discordDeferredChannelResponse,
  discordDeferredEphemeralResponse,
  discordMessageResponse,
  interactionApplicationId,
  interactionDiscordUserId,
  interactionDiscordUsername,
  interactionChannelId,
  interactionGuildId,
  interactionToken,
  parseButtonCustomId,
  parseLinkSlashOptions,
  parseSlashOptionBoolean,
  parseSlashOptionInteger,
  parseSlashOptionString,
  parseVrSlashLevel,
  resolveDiscordPublicKey,
  verifyDiscordInteractionRequest,
  type DiscordInteractionPayload,
} from "@/lib/discord/interactions";
import { emitAdminAlert } from "@/lib/events/admin-alerts";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import {
  recordMemberLinkHelpRequest,
  resolveDiscordHelpContext,
} from "@/lib/member-link/member-link-help-queue.server";
import { getDiscordBotPending } from "@/lib/vr/repository";
import {
  handleDiscordThpButtonConfirm,
  handleDiscordThpCharacterPick,
  handleDiscordThpSlash,
} from "@/lib/thp/service";
import { buildThpSlashDiscordResponse } from "@/lib/thp/discord-slash-response";
import { isDiscordThpSlashCommand } from "@/lib/thp/discord-command-names";
import {
  handleDiscordKillsButtonConfirm,
  handleDiscordKillsCharacterPick,
  handleDiscordKillsSlash,
} from "@/lib/kills/service";
import { isDiscordKillsSlashCommand } from "@/lib/kills/discord-command-names";
import {
  handleDiscordHelp,
  handleDiscordLanguage,
  handleDiscordLinkAlliance,
  handleDiscordLinkCommanderSlash,
  handleDiscordLinkFuzzyPick,
  handleDiscordLinkIdentityConfirm,
  handleDiscordLinkStartOver,
  handleDiscordLinkToAshedSeat,
  handleDiscordLinkUser,
  handleDiscordSetVrReportChannel,
  handleDiscordUnlinkPick,
  handleDiscordUnlinkWithContext,
  handleDiscordVrButtonConfirm,
  handleDiscordVrCharacterPick,
  handleDiscordVrReport,
  handleDiscordVrSlash,
  handleDiscordWeeklyPass,
  handleDiscordWeeklyPassCharacterPick,
  handleDiscordWalkthroughDone,
  handleDiscordWhatIsMyKills,
  handleDiscordWhatIsMyThp,
  handleDiscordWhatIsMyVr,
  resolveAllianceForGuild,
} from "@/lib/vr/service";
import { resolveSetupMessage } from "@/lib/vr/bot-user-context";
import {
  isDiscordCommanderLinkCommand,
  isDiscordLanguageSlashCommand,
  isDiscordVrSlashCommand,
} from "@/lib/vr/discord-command-names";
import {
  handleDiscordSetBankingChannel,
  handleDiscordSetRegularEventsChannel,
  handleDiscordSetSeasonalEventsChannel,
} from "@/lib/battle-plan/discord-channel-handlers.server";
import {
  handleDiscordWhatIsMyThpChart,
  handleDiscordWhatIsMyVrChart,
  isDiscordThpChartCommand,
  isDiscordVrChartCommand,
} from "@/lib/vr/bot-chart-query";
import {
  handleDiscordSetTrainChannel,
  handleDiscordTrainConductorPick,
  handleDiscordTrainIsReady,
  handleDiscordWhoIsConductor,
  handleDiscordSetConductor,
} from "@/lib/trains/discord-bot-handlers.server";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  handleDiscordMyEngineers,
  handleDiscordProfessionSelect,
  handleDiscordProfessionSwitchConfirm,
  handleDiscordSetProfessionChannel,
  handleDiscordSwitchProfession,
} from "@/lib/professions/discord-bot-handlers.server";
import {
  buildProfessionSelectButtons,
  buildProfessionSwitchConfirmButtons,
} from "@/lib/discord/interactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Screenshot OCR can exceed Discord's 3s ACK; deferred work continues via waitUntil. */
export const maxDuration = 60;

/** Link flows may include UIDs; keep those replies ephemeral-only. */
const EPHEMERAL = { ephemeral: true } as const;

type BackgroundTask = () => Promise<void>;

function scheduleBackgroundTask(
  scheduleBackground: ((task: BackgroundTask) => void) | undefined,
  task: BackgroundTask,
) {
  if (scheduleBackground) {
    scheduleBackground(task);
    return;
  }
  if (process.env.VERCEL) {
    waitUntil(task());
    return;
  }
  void task();
}

function discordButtonResponse(
  content: string,
  components?: ReturnType<typeof buildWalkthroughDoneButton>,
  options?: { ephemeral?: boolean },
) {
  return discordComponentMessageResponse(content, components, options ?? EPHEMERAL);
}

async function resolveInteractionContext(payload: DiscordInteractionPayload) {
  const discordUserId = interactionDiscordUserId(payload);
  const guildId = interactionGuildId(payload);
  const locale = discordUserId
    ? await getDiscordBotLocale(discordUserId, payload.locale)
    : ("en-US" as DiscordBotLocale);
  const allianceId = await resolveAllianceForGuild(guildId);
  return { discordUserId, guildId, locale, allianceId };
}

async function setupMessage(
  locale: DiscordBotLocale,
  guildId: string | null,
  discordUserId: string,
): Promise<string> {
  if (process.env.DISCORD_ALLIANCE_ID?.trim()) {
    const t = createDiscordTranslator(locale);
    return t("errors.legacyMisconfigured");
  }
  return resolveSetupMessage(locale, guildId, discordUserId);
}

async function handleLinkCommanderSlash(
  payload: DiscordInteractionPayload,
  input: {
    discordUserId: string;
    guildId: string;
    locale: DiscordBotLocale;
    allianceId: string | null;
    discordUsername: string | undefined;
  },
) {
  const { replace } = parseLinkSlashOptions(payload);

  const result = await handleDiscordLinkCommanderSlash({
    allianceId: input.allianceId,
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    replaceAll: replace,
    locale: input.locale,
  });

  return discordMessageResponse(result.reply, undefined, EPHEMERAL);
}

async function handleSlashCommand(
  payload: DiscordInteractionPayload,
  scheduleBackground?: (task: BackgroundTask) => void,
) {
  const commandName = payload.data?.name;
  const { discordUserId, guildId, locale, allianceId } =
    await resolveInteractionContext(payload);
  const discordUsername = interactionDiscordUsername(payload);
  const t = createDiscordTranslator(locale);

  if (!discordUserId) {
    return discordMessageResponse(t("errors.unknownUser"));
  }

  if (commandName === "help") {
    const result = await handleDiscordHelp({
      guildId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  if (isDiscordLanguageSlashCommand(commandName)) {
    const choice = parseSlashOptionString(payload, "locale");
    const parsed = parseLanguageChoice(choice);
    if (!parsed) {
      return discordMessageResponse(t("errors.invalidLanguage"));
    }
    const result = await handleDiscordLanguage({
      discordUserId,
      locale: parsed,
    });
    return discordMessageResponse(result.reply);
  }

  if (commandName === "link-alliance") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const tag = parseSlashOptionString(payload, "tag");
    const name = parseSlashOptionString(payload, "name");
    const result = await handleDiscordLinkAlliance({
      guildId,
      discordUserId,
      tag: tag ?? "",
      allianceName: name,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  if (commandName === "set-vr-report-channel") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const channelId = interactionChannelId(payload);
    if (!channelId) {
      return discordMessageResponse(t("errors.serverError"));
    }
    const result = await handleDiscordSetVrReportChannel({
      guildId,
      channelId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  if (commandName === "set-train-channel") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const channelId = interactionChannelId(payload);
    if (!channelId) {
      return discordMessageResponse(t("errors.serverError"));
    }
    const result = await handleDiscordSetTrainChannel({
      guildId,
      channelId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  if (commandName === "set-seasonal-events-channel") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const channelId = interactionChannelId(payload);
    if (!channelId) {
      return discordMessageResponse(t("errors.serverError"));
    }
    const result = await handleDiscordSetSeasonalEventsChannel({
      guildId,
      channelId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  if (commandName === "set-regular-events-channel") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const channelId = interactionChannelId(payload);
    if (!channelId) {
      return discordMessageResponse(t("errors.serverError"));
    }
    const result = await handleDiscordSetRegularEventsChannel({
      guildId,
      channelId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  if (commandName === "set-banking-channel") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const channelId = interactionChannelId(payload);
    if (!channelId) {
      return discordMessageResponse(t("errors.serverError"));
    }
    const result = await handleDiscordSetBankingChannel({
      guildId,
      channelId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  if (commandName === "link-ashed") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const tag = parseSlashOptionString(payload, "tag");
    const result = await handleDiscordLinkToAshedSeat({
      guildId,
      discordUserId,
      tag: tag ?? "",
      locale,
    });
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "link") {
    const result = await handleDiscordLinkUser({
      guildId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (isDiscordCommanderLinkCommand(commandName)) {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    return handleLinkCommanderSlash(payload, {
      discordUserId,
      guildId,
      locale,
      allianceId,
      discordUsername,
    });
  }

  if (commandName === "unlink") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const name = parseSlashOptionString(payload, "name");
    const result = await handleDiscordUnlinkWithContext({
      guildId,
      discordUserId,
      locale,
      memberName: name,
    });
    if (result.picker?.length) {
      return discordMessageResponse(
        result.reply,
        buildCharacterPickerButtons(result.picker, "unlink"),
      );
    }
    return discordMessageResponse(result.reply);
  }

  if (!allianceId) {
    return discordMessageResponse(
      await setupMessage(locale, guildId, discordUserId),
    );
  }

  if (isDiscordVrSlashCommand(commandName)) {
    const explicitInstituteLevel = parseVrSlashLevel(payload);
    const result = await handleDiscordVrSlash({
      allianceId,
      discordUserId,
      explicitInstituteLevel,
      locale,
    });

    if (result.characterPicker?.length) {
      return discordMessageResponse(
        result.reply,
        buildCharacterPickerButtons(result.characterPicker),
      );
    }
    if (result.needsConfirmation && result.proposedVr != null) {
      return discordMessageResponse(
        result.reply,
        buildVrConfirmButtons(result.proposedVr, {
          yes: t("buttons.yes"),
          no: t("buttons.no"),
        }),
      );
    }
    return discordMessageResponse(result.reply);
  }

  if (isDiscordThpSlashCommand(commandName)) {
    const explicitTotal = parseSlashOptionInteger(payload, "total");
    const attachment = parseResolvedAttachment(payload, "screenshot");
    const thpLabels = {
      yes: t("buttons.yes"),
      no: t("buttons.no"),
    };

    // Screenshot OCR regularly exceeds Discord's ~3s ACK window — defer, then edit.
    if (attachment) {
      const applicationId = interactionApplicationId(payload);
      const token = interactionToken(payload);
      if (!applicationId || !token) {
        console.error("[discord-bot] thp screenshot missing application_id/token");
        return discordMessageResponse(t("errors.serverError"), undefined, EPHEMERAL);
      }

      scheduleBackgroundTask(scheduleBackground, async () => {
        try {
          let screenshotBuffer: Buffer;
          try {
            screenshotBuffer = await downloadDiscordAttachment(attachment);
          } catch (error) {
            console.error("[discord-bot] thp screenshot download failed", error);
            await editDiscordOriginalInteraction({
              applicationId,
              interactionToken: token,
              content: t("thp.ocrFailed"),
              ephemeral: true,
            });
            return;
          }

          const result = await handleDiscordThpSlash({
            allianceId,
            discordUserId,
            explicitTotal,
            screenshotBuffer,
            locale,
          });
          const response = buildThpSlashDiscordResponse(result, thpLabels);
          await editDiscordOriginalInteraction({
            applicationId,
            interactionToken: token,
            content: response.data.content,
            components: response.data.components,
            ephemeral: true,
          });
        } catch (error) {
          console.error("[discord-bot] deferred thp screenshot failed", error);
          await editDiscordOriginalInteraction({
            applicationId,
            interactionToken: token,
            content: t("errors.serverError"),
            ephemeral: true,
          });
        }
      });

      return discordDeferredEphemeralResponse();
    }

    const result = await handleDiscordThpSlash({
      allianceId,
      discordUserId,
      explicitTotal,
      screenshotBuffer: null,
      locale,
    });
    return buildThpSlashDiscordResponse(result, thpLabels);
  }

  if (isDiscordKillsSlashCommand(commandName)) {
    const explicitTotal = parseSlashOptionInteger(payload, "total");
    const result = await handleDiscordKillsSlash({
      allianceId,
      discordUserId,
      explicitTotal,
      locale,
    });

    if (result.characterPicker?.length) {
      return discordMessageResponse(
        result.reply,
        buildCharacterPickerButtons(result.characterPicker, "kills"),
        EPHEMERAL,
      );
    }
    if (result.needsConfirmation && result.proposedTotal != null) {
      return discordMessageResponse(
        result.reply,
        buildKillsConfirmButtons({
          yes: t("buttons.yes"),
          no: t("buttons.no"),
        }),
        EPHEMERAL,
      );
    }
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "weekly-pass") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    if (!allianceId) {
      return discordMessageResponse(
        await setupMessage(locale, guildId, discordUserId),
        undefined,
        EPHEMERAL,
      );
    }
    const active = parseSlashOptionBoolean(payload, "active") ?? true;
    const result = await handleDiscordWeeklyPass({
      discordUserId,
      allianceId,
      guildId,
      locale,
      active,
    });
    if (result.characterPicker?.length) {
      return discordMessageResponse(
        result.reply,
        buildCharacterPickerButtons(result.characterPicker, "weekly-pass"),
        EPHEMERAL,
      );
    }
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "vr-report" || commandName === "takedown-teams") {
    const teamCount = parseSlashOptionInteger(payload, "teams");
    const result = await handleDiscordVrReport({
      allianceId,
      discordUserId,
      commandName:
        commandName === "takedown-teams" ? "takedown-teams" : "vr-report",
      teamCount,
      locale,
    });
    // Channel-visible so the whole alliance can read standings / teams.
    return discordMessageResponse(result.reply, undefined, { ephemeral: false });
  }

  if (commandName === "what-is-my-vr") {
    const result = await handleDiscordWhatIsMyVr({
      allianceId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply, undefined, { ephemeral: false });
  }

  if (commandName === "what-is-my-thp") {
    const result = await handleDiscordWhatIsMyThp({
      allianceId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply, undefined, { ephemeral: false });
  }

  if (isDiscordVrChartCommand(commandName) || isDiscordThpChartCommand(commandName)) {
    const applicationId = interactionApplicationId(payload);
    const token = interactionToken(payload);
    if (!applicationId || !token) {
      console.error("[discord-bot] chart command missing application_id/token");
      return discordMessageResponse(t("errors.serverError"), undefined, EPHEMERAL);
    }

    const chartKind = isDiscordVrChartCommand(commandName) ? "vr" : "thp";
    scheduleBackgroundTask(scheduleBackground, async () => {
      try {
        const result =
          chartKind === "vr"
            ? await handleDiscordWhatIsMyVrChart({
                allianceId,
                discordUserId,
                locale,
              })
            : await handleDiscordWhatIsMyThpChart({
                allianceId,
                discordUserId,
                locale,
              });

        if (!result.ok) {
          await editDiscordOriginalInteraction({
            applicationId,
            interactionToken: token,
            content: result.content,
          });
          return;
        }

        await editDiscordOriginalInteractionWithFiles({
          applicationId,
          interactionToken: token,
          content: result.content,
          files: result.files,
        });
      } catch (error) {
        console.error("[discord-bot] deferred chart render failed", error);
        await editDiscordOriginalInteraction({
          applicationId,
          interactionToken: token,
          content: t("errors.serverError"),
        });
      }
    });

    return discordDeferredChannelResponse();
  }

  if (commandName === "what-is-my-kill-count") {
    const result = await handleDiscordWhatIsMyKills({
      allianceId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply, undefined, { ephemeral: false });
  }

  if (commandName === "who-is-conductor") {
    const date = parseSlashOptionString(payload, "date");
    const result = await handleDiscordWhoIsConductor({
      allianceId,
      discordUserId,
      locale,
      date,
    });
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "set-conductor") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const name = parseSlashOptionString(payload, "name");
    const date = parseSlashOptionString(payload, "date");
    if (!name?.trim()) {
      return discordMessageResponse(t("train.usageSetConductor"), undefined, EPHEMERAL);
    }
    const result = await handleDiscordSetConductor({
      allianceId,
      guildId,
      discordUserId,
      locale,
      name,
      date,
    });
    if (result.pickCandidates?.length) {
      return discordMessageResponse(
        result.reply,
        buildTrainPickButtons(result.pickCandidates),
        EPHEMERAL,
      );
    }
    if (result.pendingPick) {
      return discordMessageResponse(
        result.reply,
        buildTrainConfirmButtons(
          result.pendingPick.memberId,
          result.pendingPick.date,
          { yes: t("buttons.yes"), no: t("buttons.no") },
        ),
        EPHEMERAL,
      );
    }
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "train-is-ready") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const date = parseSlashOptionString(payload, "date");
    const result = await handleDiscordTrainIsReady({
      allianceId,
      guildId,
      discordUserId,
      locale,
      date,
    });
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "switch-profession") {
    const result = await handleDiscordSwitchProfession({
      guildId,
      discordUserId,
      locale,
    });
    if (result.showProfessionSelect) {
      return discordMessageResponse(
        result.reply,
        buildProfessionSelectButtons(),
        EPHEMERAL,
      );
    }
    if (result.showSwitchConfirm) {
      return discordMessageResponse(
        result.reply,
        buildProfessionSwitchConfirmButtons(result.showSwitchConfirm),
        EPHEMERAL,
      );
    }
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "my-engineers") {
    const result = await handleDiscordMyEngineers({
      guildId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "set-profession-channel") {
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    const channelId = interactionChannelId(payload);
    if (!channelId) {
      return discordMessageResponse(t("errors.serverError"));
    }
    const result = await handleDiscordSetProfessionChannel({
      guildId,
      channelId,
      discordUserId,
      locale,
    });
    return discordMessageResponse(result.reply);
  }

  return discordMessageResponse(t("errors.unknownCommand"));
}

async function handleButton(payload: DiscordInteractionPayload) {
  const parsed = parseButtonCustomId(payload.data?.custom_id);
  if (!parsed) {
    const t = createDiscordTranslator("en-US");
    return discordButtonResponse(t("errors.unknownCommand"));
  }

  const { discordUserId, locale, allianceId } =
    await resolveInteractionContext(payload);
  const discordUsername = interactionDiscordUsername(payload);
  const t = createDiscordTranslator(locale);

  if (!discordUserId) {
    return discordButtonResponse(t("errors.unknownUser"));
  }
  if (!allianceId) {
    return discordButtonResponse(
      await setupMessage(locale, interactionGuildId(payload), discordUserId),
    );
  }

  if (parsed.kind === "link_confirm") {
    const result = await handleDiscordLinkIdentityConfirm({
      allianceId,
      guildId: interactionGuildId(payload),
      discordUserId,
      discordUsername,
      answer: parsed.answer,
      locale,
    });
    if (result.needsOfficerAttention) {
      return discordButtonResponse(
        result.reply,
        buildLinkFailureButtons({
          startOver: t("buttons.startOver"),
          askOfficer: t("buttons.askOfficer"),
        }),
      );
    }
    return discordButtonResponse(result.reply);
  }

  if (parsed.kind === "vr_confirm") {
    const result = await handleDiscordVrButtonConfirm({
      allianceId,
      discordUserId,
      answer: parsed.answer,
      locale,
    });
    return discordButtonResponse(result.reply, undefined, { ephemeral: false });
  }

  if (parsed.kind === "thp_confirm") {
    const result = await handleDiscordThpButtonConfirm({
      allianceId,
      discordUserId,
      answer: parsed.answer,
      locale,
    });
    return discordButtonResponse(result.reply, undefined, EPHEMERAL);
  }

  if (parsed.kind === "kills_confirm") {
    const result = await handleDiscordKillsButtonConfirm({
      allianceId,
      discordUserId,
      answer: parsed.answer,
      locale,
    });
    return discordButtonResponse(result.reply, undefined, EPHEMERAL);
  }

  if (parsed.kind === "link_pick") {
    const result = await handleDiscordLinkFuzzyPick({
      allianceId,
      discordUserId,
      discordUsername,
      memberId: parsed.memberId,
      locale,
    });
    return discordButtonResponse(result.reply);
  }

  if (parsed.kind === "link_walkthrough_done") {
    const result = await handleDiscordWalkthroughDone({
      allianceId,
      discordUserId,
      locale,
    });
    if (result.pending?.kind === "link_walkthrough") {
      return discordButtonResponse(
        result.reply,
        buildWalkthroughDoneButton(t("buttons.done")),
      );
    }
    return discordButtonResponse(result.reply, []);
  }

  if (parsed.kind === "vr_character") {
    const result = await handleDiscordVrCharacterPick({
      allianceId,
      discordUserId,
      linkId: parsed.linkId,
      locale,
    });
    if (result.needsConfirmation && result.proposedVr != null) {
      return discordButtonResponse(
        result.reply,
        buildVrConfirmButtons(result.proposedVr, {
          yes: t("buttons.yes"),
          no: t("buttons.no"),
        }),
        { ephemeral: false },
      );
    }
    return discordButtonResponse(result.reply, undefined, { ephemeral: false });
  }

  if (parsed.kind === "thp_character") {
    const result = await handleDiscordThpCharacterPick({
      allianceId,
      discordUserId,
      linkId: parsed.linkId,
      locale,
    });
    if (result.needsConfirmation && result.proposedTotal != null) {
      return discordButtonResponse(
        result.reply,
        buildThpConfirmButtons({
          yes: t("buttons.yes"),
          no: t("buttons.no"),
        }),
        EPHEMERAL,
      );
    }
    return discordButtonResponse(result.reply, undefined, EPHEMERAL);
  }

  if (parsed.kind === "kills_character") {
    const result = await handleDiscordKillsCharacterPick({
      allianceId,
      discordUserId,
      linkId: parsed.linkId,
      locale,
    });
    if (result.needsConfirmation && result.proposedTotal != null) {
      return discordButtonResponse(
        result.reply,
        buildKillsConfirmButtons({
          yes: t("buttons.yes"),
          no: t("buttons.no"),
        }),
        EPHEMERAL,
      );
    }
    return discordButtonResponse(result.reply, undefined, EPHEMERAL);
  }

  if (parsed.kind === "weekly_pass_character") {
    const result = await handleDiscordWeeklyPassCharacterPick({
      allianceId,
      discordUserId,
      linkId: parsed.linkId,
      locale,
    });
    return discordButtonResponse(result.reply, undefined, EPHEMERAL);
  }

  if (parsed.kind === "link_unlink") {
    const result = await handleDiscordUnlinkPick({
      allianceId,
      discordUserId,
      linkId: parsed.linkId,
      locale,
    });
    return discordButtonResponse(result.reply, undefined, { ephemeral: false });
  }

  if (parsed.kind === "link_start_over") {
    const result = await handleDiscordLinkStartOver({
      allianceId,
      discordUserId,
      locale,
    });
    return discordButtonResponse(result.reply);
  }

  if (parsed.kind === "link_ask_officer") {
    const pendingRow = await getDiscordBotPending(discordUserId);
    const pending = pendingRow?.pending ?? null;
    const pendingGameUid =
      pending?.kind === "link_fuzzy_pick"
        ? pending.gameUid
        : pending?.kind === "link_confirm_identity"
          ? pending.gameUid
          : pending?.kind === "link_roster_miss" && pending.gameUid
            ? pending.gameUid
            : null;
    const pendingReportedName =
      pending?.kind === "link_fuzzy_pick"
        ? pending.reportedName
        : pending?.kind === "link_confirm_identity"
          ? pending.gameUserName
          : pending?.kind === "link_roster_miss" && pending.reportedName
            ? pending.reportedName
            : null;
    const gameUid =
      pendingGameUid && /^\d{12,16}$/.test(pendingGameUid) ? pendingGameUid : null;
    const reportedName = pendingReportedName?.trim() || null;

    if (!gameUid || !reportedName) {
      return discordButtonResponse(t("errors.askOfficerNeedsNameAndUid"), []);
    }

    let gameUserName: string | null = null;
    try {
      const lookup = await lookupPlayerByUid(gameUid);
      if (lookup.ok) {
        gameUserName = lookup.gameUserName;
      }
    } catch {
      // Best-effort display name for officers.
    }
    await recordMemberLinkHelpRequest({
      allianceId,
      origin: "discord",
      context: resolveDiscordHelpContext(pending),
      requesterHandle: discordUsername ?? discordUserId,
      reportedName,
      gameUid,
      gameUserName,
      discordUserId,
      discordUsername,
    });
    await emitAdminAlert({
      type: "vr_link_attention",
      count: 1,
      handles: [discordUsername ?? discordUserId],
    });
    return discordButtonResponse(t("officerNotified"), []);
  }

  if (parsed.kind === "train_pick") {
    const members = await loadAllianceMembersForBot(allianceId);
    const member = members.find((m) => m.id === parsed.memberId);
    if (!member) {
      return discordButtonResponse(t("train.pickExpired"));
    }
    return discordButtonResponse(
      t("train.confirmPick", { name: member.current_name, date: parsed.date }),
      buildTrainConfirmButtons(parsed.memberId, parsed.date, {
        yes: t("buttons.yes"),
        no: t("buttons.no"),
      }),
    );
  }

  if (parsed.kind === "train_confirm") {
    if (parsed.answer === "no") {
      return discordButtonResponse(t("train.pickCancelled"), []);
    }
    const result = await handleDiscordTrainConductorPick({
      allianceId,
      discordUserId,
      locale,
      memberId: parsed.memberId,
      date: parsed.date,
    });
    return discordButtonResponse(result.reply, []);
  }

  if (parsed.kind === "profession_select") {
    const result = await handleDiscordProfessionSelect({
      guildId: interactionGuildId(payload),
      discordUserId,
      profession: parsed.profession,
      locale,
    });
    return discordButtonResponse(result.reply, []);
  }

  if (parsed.kind === "profession_switch_confirm") {
    const result = await handleDiscordProfessionSwitchConfirm({
      guildId: interactionGuildId(payload),
      discordUserId,
      answer: parsed.answer,
      locale,
    });
    if (result.showProfessionSelect) {
      return discordButtonResponse(
        result.reply,
        buildProfessionSelectButtons(),
      );
    }
    return discordButtonResponse(result.reply, []);
  }

  return discordButtonResponse(t("errors.unknownCommand"));
}

export async function POST(request: Request) {
  const publicKey = resolveDiscordPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { error: "DISCORD_PUBLIC_KEY is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBodyBytes = Buffer.from(await request.arrayBuffer());

  if (
    !verifyDiscordInteractionRequest(
      rawBodyBytes,
      signature,
      timestamp,
      publicKey,
    )
  ) {
    console.warn("[discord] interaction signature rejected", {
      hasSignature: Boolean(signature),
      hasTimestamp: Boolean(timestamp),
      bodyBytes: rawBodyBytes.length,
    });
    return NextResponse.json({ error: "Invalid request signature." }, { status: 401 });
  }

  const rawBody = rawBodyBytes.toString("utf8");
  const payload = JSON.parse(rawBody) as DiscordInteractionPayload;

  if (payload.type === 1) {
    return NextResponse.json(DISCORD_PING_RESPONSE);
  }
  if (payload.type === 2) {
    try {
      const backgroundTasks: BackgroundTask[] = [];
      const body = await handleSlashCommand(payload, (task) => {
        backgroundTasks.push(task);
      });
      for (const task of backgroundTasks) {
        if (process.env.VERCEL) {
          waitUntil(task());
        } else {
          void task();
        }
      }
      return NextResponse.json(body);
    } catch (error) {
      console.error("[discord] slash command failed", error);
      const t = createDiscordTranslator("en-US");
      return NextResponse.json(discordMessageResponse(t("errors.serverError")));
    }
  }
  if (payload.type === 3) {
    try {
      return NextResponse.json(await handleButton(payload));
    } catch (error) {
      console.error("[discord] button interaction failed", error);
      const t = createDiscordTranslator("en-US");
      return NextResponse.json(discordMessageResponse(t("errors.serverError")));
    }
  }

  return NextResponse.json({ error: "Unsupported interaction type." }, { status: 400 });
}
