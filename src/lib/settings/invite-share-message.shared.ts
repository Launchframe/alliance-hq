type ShareMessageInput = {
  allianceName: string;
  inviteUrl?: string;
  welcomeUrl?: string;
  joinCode?: string;
  passphrase?: string;
};

function resolveDestinationUrl(input: ShareMessageInput): string {
  return (
    input.welcomeUrl?.trim() ||
    input.inviteUrl?.trim() ||
    (input.joinCode?.trim() ? `/join?code=${encodeURIComponent(input.joinCode.trim())}` : "")
  );
}

export function buildInviteLinkShareMessage(input: ShareMessageInput): string {
  const name = input.allianceName.trim() || "your alliance";
  const url = resolveDestinationUrl(input);
  let message = `You're invited to join ${name} on Alliance HQ! Just go to ${url} to get started.`;
  // When passphrase is already in the URL (`?p=`), do not ask the sender to
  // forward a second secret.
  const passphraseInUrl =
    Boolean(url) &&
    Boolean(input.passphrase?.trim()) &&
    (url.includes("p=") || url.includes("?p=") || url.includes("&p="));
  if (input.passphrase?.trim() && !passphraseInUrl) {
    message += ` Passphrase (send separately): ${input.passphrase.trim()}`;
  }
  return message;
}

export function buildJoinCodeShareMessage(input: ShareMessageInput): string {
  const name = input.allianceName.trim() || "your alliance";
  const url = resolveDestinationUrl(input);
  if (url) {
    return `You're invited to join ${name} on Alliance HQ! Just go to ${url} to get started.`;
  }
  const code = input.joinCode?.trim() ?? "";
  return `You're invited to join ${name} on Alliance HQ! Sign in at Alliance HQ, then redeem join code ${code} at /join to get started.`;
}

export function buildClaimCodeShareMessage(input: ShareMessageInput): string {
  const name = input.allianceName.trim() || "your alliance";
  const url = resolveDestinationUrl(input);
  if (url) {
    return `You're invited to claim your Commander on ${name} in Alliance HQ! Just go to ${url} to get started.`;
  }
  const code = input.joinCode?.trim() ?? "";
  return `You're invited to claim your Commander on ${name} in Alliance HQ! Sign in, then redeem code ${code} at /join to link your account.`;
}
