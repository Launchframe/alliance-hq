const DISCORD_MESSAGE_MAX_CHARS = 1900;
const DISCORD_ERROR_BODY_LOG_CHARS = 500;

/** Connection-phase failures: the request never reached Discord, so a retry cannot duplicate. */
const PRE_SEND_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function truncateDiscordContent(content: string): string {
  if (content.length <= DISCORD_MESSAGE_MAX_CHARS) {
    return content;
  }
  return `${content.slice(0, DISCORD_MESSAGE_MAX_CHARS - 20).trimEnd()}… _(truncated)_`;
}

export type PostDiscordChannelMessageOptions = {
  /** Caller tag for log triage, e.g. `battle_plan.reminder`. */
  source?: string;
};

export type PostDiscordChannelMessageResult =
  | { ok: true }
  | { ok: false; retryMayDuplicate: boolean };

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

/**
 * Post a channel message with an explicit duplicate-risk signal.
 *
 * A thrown error after the request was sent (timeout, reset) may still have
 * delivered the message (`retryMayDuplicate: true`). Pre-send / HTTP failures
 * are safe to clear claim-before-post stamps and retry.
 */
export async function postDiscordChannelMessageResult(
  channelId: string,
  content: string,
  options: PostDiscordChannelMessageOptions = {},
): Promise<PostDiscordChannelMessageResult> {
  const source = options.source ?? "unspecified";
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token || !channelId) {
    console.warn("[discord] channel message skipped — not configured.", { source });
    return { ok: false, retryMayDuplicate: false };
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: truncateDiscordContent(content) }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[discord] channel post failed", {
        source,
        channelId,
        outcome: "http_error",
        status: res.status,
        retryAfter: res.headers.get("retry-after"),
        elapsedMs: Date.now() - startedAt,
        retryMayDuplicate: false,
        body: body.slice(0, DISCORD_ERROR_BODY_LOG_CHARS),
      });
      return { ok: false, retryMayDuplicate: false };
    }

    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    const retryMayDuplicate = !(code && PRE_SEND_ERROR_CODES.has(code));
    console.error("[discord] channel post threw", {
      source,
      channelId,
      outcome: "network_error",
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: code,
      elapsedMs: Date.now() - startedAt,
      retryMayDuplicate,
    });
    return { ok: false, retryMayDuplicate };
  }
}

/**
 * Post a channel message. Always resolves to a boolean — network/API failures
 * return `false` rather than throwing so claim-before-post crons can clear
 * their idempotency stamps and retry on the next tick.
 *
 * Prefer {@link postDiscordChannelMessageResult} when ambiguous post-send
 * failures must keep the claim (to avoid duplicate Discord messages).
 */
export async function postDiscordChannelMessage(
  channelId: string,
  content: string,
  options: PostDiscordChannelMessageOptions = {},
): Promise<boolean> {
  const result = await postDiscordChannelMessageResult(
    channelId,
    content,
    options,
  );
  return result.ok;
}
