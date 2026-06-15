export const PAIRING_PURPOSES = ["device_link", "authorized_access"] as const;

export type PairingPurpose = (typeof PAIRING_PURPOSES)[number];

export type PairingMetadata = Record<string, unknown>;

export type PairingStatus = "pending" | "linked" | "expired" | "invalid";

export type CreatePairingOptions = {
  purpose: PairingPurpose;
  sourceSessionId: string;
  metadata?: PairingMetadata;
  ttlMinutes?: number;
  locale?: string;
};

export type PairingCreateResult = {
  code: string;
  linkUrl: string;
  expiresAt: string;
  purpose: PairingPurpose;
};

export type PairingCompleteResult = {
  ok: true;
  purpose: PairingPurpose;
};

export type PairingClientInfo = {
  userAgent: string | null;
};

export class PairingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONNECTED"
      | "NOT_IMPLEMENTED"
      | "FORBIDDEN"
      | "INVALID"
      | "EXPIRED"
      | "CONSUMED"
      | "TOKEN_EXPIRED",
  ) {
    super(message);
    this.name = "PairingError";
  }
}

export function pairingErrorStatus(error: PairingError): number {
  switch (error.code) {
    case "NOT_CONNECTED":
      return 404;
    case "NOT_IMPLEMENTED":
      return 501;
    case "FORBIDDEN":
      return 403;
    case "INVALID":
    case "CONSUMED":
      return 404;
    case "EXPIRED":
      return 410;
    case "TOKEN_EXPIRED":
      return 401;
    default:
      return 400;
  }
}
