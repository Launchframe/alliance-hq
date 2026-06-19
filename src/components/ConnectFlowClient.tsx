"use client";

import { useState } from "react";

import { ConnectionWalkthrough } from "@/components/ConnectionWalkthrough";
import { InviteWelcomeClient } from "@/components/native-alliance/InviteWelcomeClient";

type Props = {
  showWelcomeChoice: boolean;
};

export function ConnectFlowClient({ showWelcomeChoice: initialWelcome }: Props) {
  const [showWelcomeChoice, setShowWelcomeChoice] = useState(initialWelcome);

  if (showWelcomeChoice) {
    return (
      <InviteWelcomeClient onConnectAshed={() => setShowWelcomeChoice(false)} />
    );
  }

  return <ConnectionWalkthrough />;
}
