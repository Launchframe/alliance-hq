"use client";

import { useState } from "react";

import { ConnectionWalkthrough } from "@/components/ConnectionWalkthrough";
import { InviteWelcomeClient } from "@/components/native-alliance/InviteWelcomeClient";

type Props = {
  showWelcomeChoice: boolean;
  skipWalkthroughToPaste?: boolean;
  skipLinkPhoneStep?: boolean;
};

export function ConnectFlowClient({
  showWelcomeChoice: initialWelcome,
  skipWalkthroughToPaste = false,
  skipLinkPhoneStep = false,
}: Props) {
  const [showWelcomeChoice, setShowWelcomeChoice] = useState(initialWelcome);

  if (showWelcomeChoice) {
    return (
      <InviteWelcomeClient onConnectAshed={() => setShowWelcomeChoice(false)} />
    );
  }

  return (
    <ConnectionWalkthrough
      skipWalkthroughToPaste={skipWalkthroughToPaste}
      skipLinkPhoneStep={skipLinkPhoneStep}
    />
  );
}
