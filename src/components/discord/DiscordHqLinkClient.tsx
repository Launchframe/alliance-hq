"use client";

import { signIn } from "next-auth/react";

export function DiscordHqLinkClient({
  nonce,
  labels,
}: {
  nonce: string;
  labels: {
    continueWithDiscord: string;
  };
}) {
  const callbackUrl = `/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`;

  return (
    <button
      type="button"
      onClick={() => void signIn("discord", { callbackUrl })}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
    >
      {labels.continueWithDiscord}
    </button>
  );
}
