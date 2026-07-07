"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ShellActivityState } from "./ShellActivityProvider";

type Props = {
  activity: ShellActivityState;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function ShellActivityIndicator({ activity }: Props) {
  const t = useTranslations("shellActivity");

  if (activity.kind === "idle") {
    return null;
  }

  const showTopBar =
    activity.kind === "navigating" || activity.kind === "allianceSwitch";
  const showOverlay =
    activity.kind === "allianceSwitch" || activity.kind === "sessionChange";

  let overlayMessage = t("loadingPage");
  if (activity.kind === "allianceSwitch") {
    overlayMessage = activity.tag
      ? t("switchingAllianceTo", { tag: activity.tag })
      : t("switchingAlliance");
  } else if (activity.kind === "sessionChange") {
    const key = {
      signOut: "signingOut",
      connect: "continuingToApp",
      invite: "acceptingInvite",
      joinCode: "acceptingJoinCode",
      memberLink: "completingMemberLink",
    }[activity.reason] as Parameters<typeof t>[0];
    overlayMessage = t(key);
  }

  return (
    <>
      {showTopBar ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden bg-hq-accent/20"
          role="progressbar"
          aria-valuetext={overlayMessage}
        >
          <div className="h-full w-1/3 animate-shell-activity bg-hq-accent" />
        </div>
      ) : null}

      {showOverlay ? (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 px-4 backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div
            className={cn(
              "flex max-w-sm items-center gap-3 rounded-xl border border-hq-border",
              "bg-hq-surface px-4 py-3 shadow-lg",
            )}
          >
            <Loader2
              className="h-5 w-5 shrink-0 animate-spin text-hq-accent"
              aria-hidden
            />
            <p className="text-sm font-medium text-hq-fg">{overlayMessage}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
