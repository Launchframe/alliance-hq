import {
  buildCharacterPickerButtons,
  buildThpConfirmButtons,
  discordMessageResponse,
} from "@/lib/discord/interactions";
import type { ThpCommandResult } from "@/lib/thp/types";

type ThpButtonLabels = { yes: string; no: string };

/** Shared `/thp` reply shape for sync ACK and deferred @original edits. */
export function buildThpSlashDiscordResponse(
  result: ThpCommandResult,
  labels: ThpButtonLabels,
) {
  if (result.characterPicker?.length) {
    return discordMessageResponse(
      result.reply,
      buildCharacterPickerButtons(result.characterPicker, "thp"),
      { ephemeral: true },
    );
  }
  if (result.needsConfirmation && result.proposedTotal != null) {
    return discordMessageResponse(
      result.reply,
      buildThpConfirmButtons(labels),
      { ephemeral: true },
    );
  }
  return discordMessageResponse(result.reply, undefined, { ephemeral: true });
}
