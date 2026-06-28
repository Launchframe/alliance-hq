"use client";

import { JoinCodeClient } from "@/components/auth/JoinCodeClient";
import { resolveDiscordPostLinkOnboardingRedirect } from "@/lib/navigation/safe-redirect.shared";

export function DiscordHqLinkCompleteSuccess({
  labels,
}: {
  labels: {
    successHeading: string;
    successBody: string;
    joinIntro: string;
  };
}) {
  return (
    <div className="w-full max-w-md space-y-6">
      <div className="rounded-xl border border-green-700 bg-green-950/40 p-6 text-center">
        <p className="text-lg font-semibold text-green-300">{labels.successHeading}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-green-200">
          {labels.successBody}
        </p>
      </div>

      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <p className="mb-4 text-sm text-[#8b949e]">{labels.joinIntro}</p>
        <JoinCodeClient
          showBackLink={false}
          showHeader={false}
          embedded
          redirectToOverride={resolveDiscordPostLinkOnboardingRedirect()}
        />
      </div>
    </div>
  );
}
