import { NextResponse } from "next/server";

import {
  DISCORD_PING_RESPONSE,
  buildCharacterPickerButtons,
  buildLinkFailureButtons,
  buildLinkFuzzyButtons,
  buildVrConfirmButtons,
  buildWalkthroughDoneButton,
  discordMessageResponse,
  interactionDiscordUserId,
  interactionDiscordUsername,
  parseButtonCustomId,
  parseLinkSlashOptions,
  parseVrSlashLevel,
  verifyDiscordInteractionRequest,
  type DiscordInteractionPayload,
} from "@/lib/discord/interactions";
import { emitAdminAlert } from "@/lib/events/admin-alerts";
import {
  handleDiscordLinkFuzzyPick,
  handleDiscordLinkStartOver,
  handleDiscordLinkSlash,
  handleDiscordVrButtonConfirm,
  handleDiscordVrCharacterPick,
  handleDiscordVrSlash,
  handleDiscordWalkthroughDone,
  resolveDiscordAllianceId,
} from "@/lib/vr/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function discordAllianceConfigMessage(): string {
  if (process.env.DISCORD_ALLIANCE_ID?.trim()) {
    return (
      "Discord VR tracking is misconfigured: DISCORD_ALLIANCE_ID does not match an Alliance HQ alliance. " +
      "Use the HQ alliance id or Ashed alliance id from /admin/alliances."
    );
  }
  return "Discord VR tracking is not configured for this server yet.";
}

async function handleSlashCommand(payload: DiscordInteractionPayload) {
  const commandName = payload.data?.name;
  const allianceId = await resolveDiscordAllianceId();
  const discordUserId = interactionDiscordUserId(payload);
  const discordUsername = interactionDiscordUsername(payload);

  if (!allianceId) {
    return discordMessageResponse(discordAllianceConfigMessage());
  }
  if (!discordUserId) {
    return discordMessageResponse("Could not identify your Discord account.");
  }

  if (commandName === "link") {
    const { name, uid } = parseLinkSlashOptions(payload);
    const result = await handleDiscordLinkSlash({
      allianceId,
      discordUserId,
      discordUsername,
      reportedName: name,
      gameUid: uid,
    });

    if (result.pending?.kind === "link_fuzzy_pick") {
      return discordMessageResponse(
        result.reply,
        buildLinkFuzzyButtons(result.pending.candidates),
      );
    }
    if (result.pending?.kind === "link_walkthrough") {
      return discordMessageResponse(
        result.reply,
        buildWalkthroughDoneButton(),
      );
    }
    if (result.needsOfficerAttention) {
      return discordMessageResponse(result.reply, buildLinkFailureButtons());
    }
    return discordMessageResponse(result.reply);
  }

  if (commandName === "vr" || commandName === "immunity") {
    const explicitLevel = parseVrSlashLevel(payload);
    const result = await handleDiscordVrSlash({
      allianceId,
      discordUserId,
      explicitLevel,
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
        buildVrConfirmButtons(result.proposedVr),
      );
    }
    return discordMessageResponse(result.reply);
  }

  return discordMessageResponse("Unknown command.");
}

async function handleButton(payload: DiscordInteractionPayload) {
  const parsed = parseButtonCustomId(payload.data?.custom_id);
  if (!parsed) return discordMessageResponse("Unknown button.");

  const allianceId = await resolveDiscordAllianceId();
  const discordUserId = interactionDiscordUserId(payload);
  const discordUsername = interactionDiscordUsername(payload);
  if (!allianceId || !discordUserId) {
    return discordMessageResponse(
      allianceId ? "Could not identify your Discord account." : discordAllianceConfigMessage(),
    );
  }

  if (parsed.kind === "vr_confirm") {
    const result = await handleDiscordVrButtonConfirm({
      allianceId,
      discordUserId,
      answer: parsed.answer,
    });
    return discordMessageResponse(result.reply);
  }

  if (parsed.kind === "link_pick") {
    const result = await handleDiscordLinkFuzzyPick({
      allianceId,
      discordUserId,
      discordUsername,
      memberId: parsed.memberId,
    });
    return discordMessageResponse(result.reply);
  }

  if (parsed.kind === "link_walkthrough_done") {
    const result = await handleDiscordWalkthroughDone({
      allianceId,
      discordUserId,
    });
    if (result.pending?.kind === "link_walkthrough") {
      return discordMessageResponse(result.reply, buildWalkthroughDoneButton());
    }
    return discordMessageResponse(result.reply);
  }

  if (parsed.kind === "vr_character") {
    const result = await handleDiscordVrCharacterPick({
      allianceId,
      discordUserId,
      linkId: parsed.linkId,
    });
    if (result.needsConfirmation && result.proposedVr != null) {
      return discordMessageResponse(
        result.reply,
        buildVrConfirmButtons(result.proposedVr),
      );
    }
    return discordMessageResponse(result.reply);
  }

  if (parsed.kind === "link_start_over") {
    const result = await handleDiscordLinkStartOver({
      allianceId,
      discordUserId,
    });
    return discordMessageResponse(result.reply, buildWalkthroughDoneButton());
  }

  if (parsed.kind === "link_ask_officer") {
    await emitAdminAlert({
      type: "vr_link_attention",
      count: 1,
      handles: [discordUsername ?? discordUserId],
    });
    return discordMessageResponse(
      "An officer has been notified on Alliance HQ. They can reach out to you here on Discord.",
    );
  }

  return discordMessageResponse("Unknown button.");
}

export async function POST(request: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!publicKey) {
    return NextResponse.json(
      { error: "DISCORD_PUBLIC_KEY is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();

  if (
    !verifyDiscordInteractionRequest(rawBody, signature, timestamp, publicKey)
  ) {
    return NextResponse.json({ error: "Invalid request signature." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as DiscordInteractionPayload;

  if (payload.type === 1) {
    return NextResponse.json(DISCORD_PING_RESPONSE);
  }
  if (payload.type === 2) {
    try {
      return NextResponse.json(await handleSlashCommand(payload));
    } catch (error) {
      console.error("[discord] slash command failed", error);
      return NextResponse.json(
        discordMessageResponse(
          "Something went wrong on our side. Try again in a moment.",
        ),
      );
    }
  }
  if (payload.type === 3) {
    try {
      return NextResponse.json(await handleButton(payload));
    } catch (error) {
      console.error("[discord] button interaction failed", error);
      return NextResponse.json(
        discordMessageResponse(
          "Something went wrong on our side. Try again in a moment.",
        ),
      );
    }
  }

  return NextResponse.json({ error: "Unsupported interaction type." }, { status: 400 });
}
