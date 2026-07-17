import nacl from "tweetnacl";

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Discord signs `timestamp` bytes + raw UTF-8 body bytes (not a JS string concat). */
export function verifyDiscordInteractionRequest(
  rawBody: string | Uint8Array,
  signature: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): boolean {
  if (!signature || !timestamp || !publicKeyHex) return false;
  try {
    const bodyBytes =
      typeof rawBody === "string"
        ? Buffer.from(rawBody, "utf8")
        : Buffer.from(rawBody);
    const message = Buffer.concat([Buffer.from(timestamp, "utf8"), bodyBytes]);
    return nacl.sign.detached.verify(
      message,
      hexToUint8Array(signature),
      hexToUint8Array(publicKeyHex),
    );
  } catch {
    return false;
  }
}

/** Accept DISCORD_PUBLIC_KEY (documented) or legacy DISCORD_BOT_PUBLIC_KEY. */
export function resolveDiscordPublicKey(): string | null {
  const raw =
    process.env.DISCORD_PUBLIC_KEY?.trim() ||
    process.env.DISCORD_BOT_PUBLIC_KEY?.trim();
  if (!raw) return null;
  return raw.replace(/^["']|["']$/g, "");
}

export type DiscordInteractionPayload = {
  type: number;
  id?: string;
  token?: string;
  application_id?: string;
  guild_id?: string;
  channel_id?: string;
  locale?: string;
  data?: {
    name?: string;
    options?: Array<{ name: string; type: number; value?: unknown }>;
    custom_id?: string;
    resolved?: {
      attachments?: Record<
        string,
        { url?: string; filename?: string; content_type?: string }
      >;
    };
  };
  member?: {
    user?: { id?: string; username?: string };
  };
  user?: { id?: string; username?: string };
};

export function interactionGuildId(
  payload: DiscordInteractionPayload,
): string | null {
  return payload.guild_id?.trim() || null;
}

export function interactionChannelId(
  payload: DiscordInteractionPayload,
): string | null {
  return payload.channel_id?.trim() || null;
}

export function interactionDiscordUserId(
  payload: DiscordInteractionPayload,
): string | null {
  return payload.member?.user?.id ?? payload.user?.id ?? null;
}

export function interactionDiscordUsername(
  payload: DiscordInteractionPayload,
): string | undefined {
  return payload.member?.user?.username ?? payload.user?.username;
}

export function parseSlashOptionString(
  payload: DiscordInteractionPayload,
  name: string,
): string | undefined {
  const option = payload.data?.options?.find((o) => o.name === name);
  return typeof option?.value === "string" ? option.value : undefined;
}

export function parseSlashOptionInteger(
  payload: DiscordInteractionPayload,
  name: string,
): number | undefined {
  const option = payload.data?.options?.find((o) => o.name === name);
  return typeof option?.value === "number" ? option.value : undefined;
}

export function parseSlashOptionBoolean(
  payload: DiscordInteractionPayload,
  name: string,
): boolean | undefined {
  const option = payload.data?.options?.find((o) => o.name === name);
  return typeof option?.value === "boolean" ? option.value : undefined;
}

export function parseVrSlashLevel(
  payload: DiscordInteractionPayload,
): number | null | undefined {
  const option = payload.data?.options?.find((o) => o.name === "level");
  if (!option) return undefined;
  if (typeof option.value === "number") return option.value;
  return null;
}

export function parseLinkSlashOptions(payload: DiscordInteractionPayload): {
  replace?: boolean;
} {
  const replaceOption = payload.data?.options?.find((o) => o.name === "replace");
  if (replaceOption == null) return {};
  return { replace: replaceOption.value === true };
}

export type ParsedButton =
  | { kind: "vr_confirm"; answer: "yes" | "no" }
  | { kind: "thp_confirm"; answer: "yes" | "no" }
  | { kind: "kills_confirm"; answer: "yes" | "no" }
  | { kind: "link_confirm"; answer: "yes" | "no" }
  | { kind: "link_pick"; memberId: string }
  | { kind: "link_walkthrough_done" }
  | { kind: "vr_character"; linkId: string }
  | { kind: "thp_character"; linkId: string }
  | { kind: "kills_character"; linkId: string }
  | { kind: "weekly_pass_character"; linkId: string }
  | { kind: "link_unlink"; linkId: string }
  | { kind: "link_start_over" }
  | { kind: "link_ask_officer" }
  | { kind: "train_pick"; memberId: string; date: string }
  | { kind: "train_confirm"; memberId: string; date: string; answer: "yes" | "no" }
  | { kind: "profession_select"; profession: "Engineer" | "War Leader" }
  | { kind: "profession_switch_confirm"; answer: "yes" | "no" };

export function parseButtonCustomId(
  customId: string | undefined,
): ParsedButton | null {
  if (!customId) return null;
  const vrConfirm = /^vr:confirm:(\d+):(yes|no)$/.exec(customId);
  if (vrConfirm) {
    return { kind: "vr_confirm", answer: vrConfirm[2] as "yes" | "no" };
  }
  const thpConfirm = /^thp:confirm:(yes|no)$/.exec(customId);
  if (thpConfirm) {
    return { kind: "thp_confirm", answer: thpConfirm[1] as "yes" | "no" };
  }
  const killsConfirm = /^kills:confirm:(yes|no)$/.exec(customId);
  if (killsConfirm) {
    return { kind: "kills_confirm", answer: killsConfirm[1] as "yes" | "no" };
  }
  const linkConfirm = /^link:confirm:(yes|no)$/.exec(customId);
  if (linkConfirm) {
    return { kind: "link_confirm", answer: linkConfirm[1] as "yes" | "no" };
  }
  const linkPick = /^link:pick:(.+)$/.exec(customId);
  if (linkPick) return { kind: "link_pick", memberId: linkPick[1]! };
  if (customId === "link:walkthrough:done") {
    return { kind: "link_walkthrough_done" };
  }
  if (customId === "link:start_over") return { kind: "link_start_over" };
  if (customId === "link:ask_officer") return { kind: "link_ask_officer" };
  const charPick = /^vr:character:(.+)$/.exec(customId);
  if (charPick) return { kind: "vr_character", linkId: charPick[1]! };
  const thpCharPick = /^thp:character:(.+)$/.exec(customId);
  if (thpCharPick) return { kind: "thp_character", linkId: thpCharPick[1]! };
  const killsCharPick = /^kills:character:(.+)$/.exec(customId);
  if (killsCharPick) return { kind: "kills_character", linkId: killsCharPick[1]! };
  const weeklyPassPick = /^weekly-pass:character:(.+)$/.exec(customId);
  if (weeklyPassPick) {
    return { kind: "weekly_pass_character", linkId: weeklyPassPick[1]! };
  }
  const unlinkPick = /^link:unlink:(.+)$/.exec(customId);
  if (unlinkPick) return { kind: "link_unlink", linkId: unlinkPick[1]! };
  const trainPick = /^train:pick:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(customId);
  if (trainPick) {
    return {
      kind: "train_pick",
      memberId: trainPick[1]!,
      date: trainPick[2]!,
    };
  }
  const trainConfirm = /^train:confirm:([^:]+):(\d{4}-\d{2}-\d{2}):(yes|no)$/.exec(
    customId,
  );
  if (trainConfirm) {
    return {
      kind: "train_confirm",
      memberId: trainConfirm[1]!,
      date: trainConfirm[2]!,
      answer: trainConfirm[3] as "yes" | "no",
    };
  }
  const profSelect = /^profession:select:(Engineer|War Leader)$/.exec(customId);
  if (profSelect) {
    return {
      kind: "profession_select",
      profession: profSelect[1] as "Engineer" | "War Leader",
    };
  }
  const profSwitchConfirm = /^profession:switch_confirm:(yes|no)$/.exec(customId);
  if (profSwitchConfirm) {
    return {
      kind: "profession_switch_confirm",
      answer: profSwitchConfirm[1] as "yes" | "no",
    };
  }
  return null;
}

export function buildProfessionSelectButtons() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "Engineer",
          custom_id: "profession:select:Engineer",
        },
        {
          type: 2,
          style: 1,
          label: "War Leader",
          custom_id: "profession:select:War Leader",
        },
      ],
    },
  ];
}

export function buildProfessionSwitchConfirmButtons(toProfession: string) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: `Yes, switch to ${toProfession}`,
          custom_id: "profession:switch_confirm:yes",
        },
        {
          type: 2,
          style: 4,
          label: "Cancel",
          custom_id: "profession:switch_confirm:no",
        },
      ],
    },
  ];
}

export function buildLinkIdentityConfirmButtons(labels: {
  yes: string;
  no: string;
}) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: labels.yes.slice(0, 80),
          custom_id: "link:confirm:yes",
        },
        {
          type: 2,
          style: 4,
          label: labels.no.slice(0, 80),
          custom_id: "link:confirm:no",
        },
      ],
    },
  ];
}

export function buildThpConfirmButtons(labels: { yes: string; no: string }) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: labels.yes.slice(0, 80),
          custom_id: "thp:confirm:yes",
        },
        {
          type: 2,
          style: 4,
          label: labels.no.slice(0, 80),
          custom_id: "thp:confirm:no",
        },
      ],
    },
  ];
}

export function buildKillsConfirmButtons(labels: { yes: string; no: string }) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: labels.yes.slice(0, 80),
          custom_id: "kills:confirm:yes",
        },
        {
          type: 2,
          style: 4,
          label: labels.no.slice(0, 80),
          custom_id: "kills:confirm:no",
        },
      ],
    },
  ];
}

export function buildVrConfirmButtons(
  proposedVr: number,
  labels: { yes: string; no: string },
) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: labels.yes.slice(0, 80),
          custom_id: `vr:confirm:${proposedVr}:yes`,
        },
        {
          type: 2,
          style: 4,
          label: labels.no.slice(0, 80),
          custom_id: `vr:confirm:${proposedVr}:no`,
        },
      ],
    },
  ];
}

export function buildLinkFuzzyButtons(
  candidates: Array<{ memberId: string; name: string }>,
) {
  return [
    {
      type: 1,
      components: candidates.slice(0, 5).map((c) => ({
        type: 2,
        style: 1,
        label: c.name.slice(0, 80),
        custom_id: `link:pick:${c.memberId}`,
      })),
    },
  ];
}

export function buildCharacterPickerButtons(
  links: Array<{ linkId: string; label: string }>,
  prefix: "vr" | "unlink" | "weekly-pass" | "thp" | "kills" = "vr",
) {
  const customIdPrefix =
    prefix === "unlink"
      ? "link:unlink"
      : prefix === "weekly-pass"
        ? "weekly-pass:character"
        : prefix === "thp"
          ? "thp:character"
          : prefix === "kills"
            ? "kills:character"
            : "vr:character";
  return [
    {
      type: 1,
      components: links.slice(0, 5).map((l) => ({
        type: 2,
        style: prefix === "unlink" ? 4 : 1,
        label: l.label.slice(0, 80),
        custom_id: `${customIdPrefix}:${l.linkId}`,
      })),
    },
  ];
}

export function buildWalkthroughDoneButton(label = "Done") {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: label.slice(0, 80),
          custom_id: "link:walkthrough:done",
        },
      ],
    },
  ];
}

export function buildTrainPickButtons(
  candidates: Array<{ memberId: string; name: string; date: string }>,
) {
  return [
    {
      type: 1,
      components: candidates.slice(0, 5).map((c) => ({
        type: 2,
        style: 1,
        label: c.name.slice(0, 80),
        custom_id: `train:pick:${c.memberId}:${c.date}`,
      })),
    },
  ];
}

export function buildTrainConfirmButtons(
  memberId: string,
  date: string,
  labels: { yes: string; no: string },
) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: labels.yes.slice(0, 80),
          custom_id: `train:confirm:${memberId}:${date}:yes`,
        },
        {
          type: 2,
          style: 4,
          label: labels.no.slice(0, 80),
          custom_id: `train:confirm:${memberId}:${date}:no`,
        },
      ],
    },
  ];
}

export function buildLinkFailureButtons(labels: {
  startOver: string;
  askOfficer: string;
}) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: labels.startOver.slice(0, 80),
          custom_id: "link:start_over",
        },
        {
          type: 2,
          style: 4,
          label: labels.askOfficer.slice(0, 80),
          custom_id: "link:ask_officer",
        },
      ],
    },
  ];
}

type DiscordComponentRow = ReturnType<typeof buildVrConfirmButtons>;

export function discordMessageResponse(
  content: string,
  components?: DiscordComponentRow,
  options?: { ephemeral?: boolean },
) {
  const ephemeral = options?.ephemeral ?? false;
  return {
    type: 4,
    data: {
      content,
      ...(ephemeral ? { flags: 64 } : {}),
      ...(components ? { components } : {}),
    },
  };
}

/**
 * ACK within Discord's ~3s window, then edit `@original` after slow work (OCR).
 * `flags: 64` keeps the eventual reply ephemeral (THP is private).
 */
export function discordDeferredEphemeralResponse() {
  return {
    type: 5,
    data: {
      flags: 64,
    },
  };
}

/**
 * Deferred ACK for channel-visible follow-ups (e.g. progress chart PNGs).
 * Omit flags so the eventual `@original` edit is public in the channel.
 */
export function discordDeferredChannelResponse() {
  return {
    type: 5,
  };
}

export function interactionApplicationId(
  payload: DiscordInteractionPayload,
): string | null {
  const fromPayload = payload.application_id?.trim();
  if (fromPayload) return fromPayload;
  return (
    process.env.DISCORD_APPLICATION_ID?.trim() ||
    process.env.AUTH_DISCORD_ID?.trim() ||
    null
  );
}

export function interactionToken(
  payload: DiscordInteractionPayload,
): string | null {
  return payload.token?.trim() || null;
}

/** Update the message that contained the clicked button (required for walkthrough Done). */
export function discordComponentMessageResponse(
  content: string,
  components?: DiscordComponentRow,
  options?: { ephemeral?: boolean },
) {
  const ephemeral = options?.ephemeral ?? true;
  return {
    type: 7,
    data: {
      content,
      ...(ephemeral ? { flags: 64 } : {}),
      // Omitting components leaves stale buttons clickable; always clear unless replaced.
      components: components ?? [],
    },
  };
}

export const DISCORD_PING_RESPONSE = { type: 1 };
