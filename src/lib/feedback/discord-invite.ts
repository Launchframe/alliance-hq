export type DiscordInviteAction =
  | { type: "open"; url: string }
  | { type: "missing" };

export function resolveDiscordInviteAction(
  inviteUrl: string | null | undefined,
): DiscordInviteAction {
  const trimmed = inviteUrl?.trim();
  if (!trimmed) {
    return { type: "missing" };
  }
  return { type: "open", url: trimmed };
}
