import { createDiscordTranslator } from "@/lib/discord/i18n";
import type { DiscordBotLocale } from "@/lib/discord/i18n";

export function formatVideoPendingApprovalDiscordMessage(input: {
  uploader: string | null;
  fileName: string;
  leaderboard: string;
  queueUrl: string;
  locale?: DiscordBotLocale;
}): string {
  const t = createDiscordTranslator(input.locale ?? "en-US");
  const uploader =
    input.uploader?.trim() || t("video.pendingApprovalUploaderFallback");
  return t("video.pendingApproval", {
    uploader,
    fileName: input.fileName,
    leaderboard: input.leaderboard,
    queueUrl: input.queueUrl,
  });
}
