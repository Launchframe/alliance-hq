import type { PairingStrategy } from "@/lib/credential-pairing/strategies/types";
import { PairingError } from "@/lib/credential-pairing/types";

/** Follow-up PR: delegate connection key with manual membership role. */
export const authorizedAccessStrategy: PairingStrategy = {
  purpose: "authorized_access",

  async validateCreate() {
    throw new PairingError(
      "Authorized user sharing is not available yet.",
      "NOT_IMPLEMENTED",
    );
  },

  async onComplete() {
    throw new PairingError(
      "Authorized user sharing is not available yet.",
      "NOT_IMPLEMENTED",
    );
  },
};
