import nacl from "tweetnacl";

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function verifyDiscordInteractionRequest(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): boolean {
  if (!signature || !timestamp || !publicKeyHex) return false;
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      hexToUint8Array(signature),
      hexToUint8Array(publicKeyHex),
    );
  } catch {
    return false;
  }
}

export type DiscordInteractionPayload = {
  type: number;
  guild_id?: string;
  locale?: string;
  data?: {
    name?: string;
    options?: Array<{ name: string; type: number; value?: unknown }>;
    custom_id?: string;
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

export function parseVrSlashLevel(
  payload: DiscordInteractionPayload,
): number | null | undefined {
  const option = payload.data?.options?.find((o) => o.name === "level");
  if (!option) return undefined;
  if (typeof option.value === "number") return option.value;
  return null;
}

export function parseLinkSlashOptions(payload: DiscordInteractionPayload): {
  name?: string;
  uid?: string;
  replace?: boolean;
} {
  const replaceOption = payload.data?.options?.find((o) => o.name === "replace");
  return {
    name: parseSlashOptionString(payload, "name"),
    uid: parseSlashOptionString(payload, "uid"),
    replace: replaceOption?.value === true,
  };
}

export type ParsedButton =
  | { kind: "vr_confirm"; answer: "yes" | "no" }
  | { kind: "link_pick"; memberId: string }
  | { kind: "link_walkthrough_done" }
  | { kind: "vr_character"; linkId: string }
  | { kind: "link_unlink"; linkId: string }
  | { kind: "link_start_over" }
  | { kind: "link_ask_officer" };

export function parseButtonCustomId(
  customId: string | undefined,
): ParsedButton | null {
  if (!customId) return null;
  const vrConfirm = /^vr:confirm:(\d+):(yes|no)$/.exec(customId);
  if (vrConfirm) {
    return { kind: "vr_confirm", answer: vrConfirm[2] as "yes" | "no" };
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
  const unlinkPick = /^link:unlink:(.+)$/.exec(customId);
  if (unlinkPick) return { kind: "link_unlink", linkId: unlinkPick[1]! };
  return null;
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
  prefix: "vr" | "unlink" = "vr",
) {
  return [
    {
      type: 1,
      components: links.slice(0, 5).map((l) => ({
        type: 2,
        style: prefix === "unlink" ? 4 : 1,
        label: l.label.slice(0, 80),
        custom_id: `${prefix === "unlink" ? "link:unlink" : "vr:character"}:${l.linkId}`,
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

export const DISCORD_PING_RESPONSE = { type: 1 };
