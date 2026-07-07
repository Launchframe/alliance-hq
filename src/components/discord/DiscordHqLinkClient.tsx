"use client";

import { signIn } from "next-auth/react";

export function DiscordHqLinkClient({
  nonce,
  callbackPath,
  labels,
}: {
  nonce: string;
  /** When set, Discord OAuth returns here (e.g. link-commander gate). */
  callbackPath?: string;
  labels: {
    continueWithDiscord: string;
  };
}) {
  const callbackUrl =
    callbackPath ??
    `/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`;

  return (
    <button
      type="button"
      onClick={() => void signIn("discord", { callbackUrl })}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-hq-discord px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
    >
      {labels.continueWithDiscord}
    </button>
  );
}
