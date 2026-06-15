import { authorizedAccessStrategy } from "@/lib/credential-pairing/strategies/authorized-access";
import { deviceLinkStrategy } from "@/lib/credential-pairing/strategies/device-link";
import type { PairingStrategy } from "@/lib/credential-pairing/strategies/types";
import type { PairingPurpose } from "@/lib/credential-pairing/types";

const STRATEGIES: Record<PairingPurpose, PairingStrategy> = {
  device_link: deviceLinkStrategy,
  authorized_access: authorizedAccessStrategy,
};

export function getPairingStrategy(purpose: PairingPurpose): PairingStrategy {
  return STRATEGIES[purpose];
}

export { deviceLinkStrategy, authorizedAccessStrategy };
export type { PairingStrategy };
