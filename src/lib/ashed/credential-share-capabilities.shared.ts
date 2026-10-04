export const CREDENTIAL_SHARE_CAPABILITIES = [
  "roster:sync",
  "video:process",
  "alliance_credentials:manage",
  "data_management:write",
] as const;

export type CredentialShareCapability =
  (typeof CREDENTIAL_SHARE_CAPABILITIES)[number];

export function isCredentialShareCapability(
  value: string,
): value is CredentialShareCapability {
  return (CREDENTIAL_SHARE_CAPABILITIES as readonly string[]).includes(value);
}

export function parseCredentialShareCapabilities(
  values: unknown,
): CredentialShareCapability[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(
    (value): value is CredentialShareCapability =>
      typeof value === "string" && isCredentialShareCapability(value),
  );
}
