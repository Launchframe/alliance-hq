import { NextResponse } from "next/server";

import {
  createDiscordTranslator,
  getDiscordBotLocale,
  parseLanguageChoice,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import {
  DISCORD_PING_RESPONSE,
  buildCharacterPickerButtons,
  buildLinkFailureButtons,
  buildLinkFuzzyButtons,
  buildVrConfirmButtons,
  buildWalkthroughDoneButton,
  discordComponentMessageResponse,
  discordMessageResponse,
  interactionDiscordUserId,
  interactionDiscordUsername,
  interactionGuildId,
  parseButtonCustomId,
  parseLinkSlashOptions,
  parseSlashOptionString,
  parseVrSlashLevel,
  resolveDiscordPublicKey,
  verifyDiscordInteractionRequest,
  type DiscordInteractionPayload,
} from "@/lib/discord/interactions";
import { emitAdminAlert } from "@/lib/events/admin-alerts";
import {
  handleDiscordHelp,
  handleDiscordLanguage,
  handleDiscordLinkAlliance,
  handleDiscordLinkFuzzyPick,
  handleDiscordLinkSlash,
  handleDiscordLinkStartOver,
  handleDiscordLinkToAshedSeat,
  handleDiscordUnlinkPick,
  handleDiscordUnlinkWithContext,
  handleDiscordVrButtonConfirm,
  handleDiscordVrCharacterPick,
  handleDiscordVrSlash,
  handleDiscordWalkthroughDone,
  resolveAllianceForGuild,
  resolveOwnerSetupAllianceId,
} from "@/lib/vr/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Link flows may include UIDs; keep those replies ephemeral-only. */
const EPHEMERAL = { ephemeral: true } as const;

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

function guildConfigMessage(locale: DiscordBotLocale): string {
  const t = createDiscordTranslator(locale);
  if (process.env.DISCORD_ALLIANCE_ID?.trim()) {
    return t("errors.legacyMisconfigured");
  }
  return t("errors.guildNotRegistered");
}

async function handleSlashCommand(payload: DiscordInteractionPayload) {
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

  if (commandName === "language") {
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

  if (commandName === "link-to-ashed-seat") {
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
    if (!guildId) {
      return discordMessageResponse(t("errors.guildNotRegistered"));
    }
    let linkAllianceId = allianceId;
    if (!linkAllianceId) {
      linkAllianceId = await resolveOwnerSetupAllianceId(guildId, discordUserId);
    }
    if (!linkAllianceId) {
      return discordMessageResponse(guildConfigMessage(locale));
    }
    const { name, uid, replace } = parseLinkSlashOptions(payload);
    const result = await handleDiscordLinkSlash({
      allianceId: linkAllianceId,
      discordUserId,
      discordUsername,
      reportedName: name,
      gameUid: uid,
      replaceAll: replace,
      locale,
    });

    if (result.pending?.kind === "link_fuzzy_pick") {
      return discordMessageResponse(
        result.reply,
        buildLinkFuzzyButtons(result.pending.candidates),
        EPHEMERAL,
      );
    }
    if (result.pending?.kind === "link_walkthrough") {
      return discordMessageResponse(
        result.reply,
        buildWalkthroughDoneButton(t("buttons.done")),
        EPHEMERAL,
      );
    }
    if (result.needsOfficerAttention) {
      return discordMessageResponse(
        result.reply,
        buildLinkFailureButtons({
          startOver: t("buttons.startOver"),
          askOfficer: t("buttons.askOfficer"),
        }),
        EPHEMERAL,
      );
    }
    return discordMessageResponse(result.reply, undefined, EPHEMERAL);
  }

  if (commandName === "unlink") {
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
    return discordMessageResponse(guildConfigMessage(locale));
  }

  if (commandName === "vr" || commandName === "immunity") {
    const explicitLevel = parseVrSlashLevel(payload);
    const result = await handleDiscordVrSlash({
      allianceId,
      discordUserId,
      explicitLevel,
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

  if (!allianceId || !discordUserId) {
    return discordButtonResponse(
      allianceId ? t("errors.unknownUser") : guildConfigMessage(locale),
    );
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
    return discordButtonResponse(
      result.reply,
      buildWalkthroughDoneButton(t("buttons.done")),
    );
  }

  if (parsed.kind === "link_ask_officer") {
    await emitAdminAlert({
      type: "vr_link_attention",
      count: 1,
      handles: [discordUsername ?? discordUserId],
    });
    return discordButtonResponse(t("officerNotified"), []);
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
      return NextResponse.json(await handleSlashCommand(payload));
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
