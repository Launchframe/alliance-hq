import type { DiscordAttachmentMeta } from "@/lib/discord/attachments";
import { parseResolvedAttachment } from "@/lib/discord/attachments";
import {
  type DiscordInteractionPayload,
  type DiscordSlashOption,
  parseSlashOptionInteger,
} from "@/lib/discord/interactions";

function subcommand(payload: DiscordInteractionPayload) {
  return payload.data?.options?.find((row) => row.type === 1);
}

function nestedInteger(
  options: DiscordSlashOption[] | undefined,
  name: string,
): number | undefined {
  const option = options?.find((row) => row.name === name);
  return typeof option?.value === "number" ? option.value : undefined;
}

/**
 * Discord mobile clients mishandle optional attachment options when another
 * optional parameter exists on the same command. `/thp` uses subcommands so the
 * screenshot path carries a required attachment; legacy flat options still parse.
 */
export function parseThpSlashInput(payload: DiscordInteractionPayload): {
  explicitTotal?: number;
  attachment: DiscordAttachmentMeta | null;
} {
  const sub = subcommand(payload);
  if (sub?.name === "screenshot") {
    return {
      explicitTotal: undefined,
      attachment:
        parseResolvedAttachment(payload, "image") ??
        parseResolvedAttachment(payload, "screenshot"),
    };
  }
  if (sub?.name === "total") {
    return {
      explicitTotal:
        nestedInteger(sub.options, "value") ??
        parseSlashOptionInteger(payload, "total"),
      attachment: null,
    };
  }

  return {
    explicitTotal: parseSlashOptionInteger(payload, "total"),
    attachment: parseResolvedAttachment(payload, "screenshot"),
  };
}
