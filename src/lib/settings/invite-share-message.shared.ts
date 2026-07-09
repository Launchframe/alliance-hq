type ShareMessageInput = {
  allianceName: string;
  inviteUrl?: string;
  joinCode?: string;
  passphrase?: string;
};

export function buildInviteLinkShareMessage(input: ShareMessageInput): string {
  const name = input.allianceName.trim() || "your alliance";
  const url = input.inviteUrl?.trim() ?? "";
  let message = `You're invited to join ${name} on Alliance HQ! Just go to ${url} to get started.`;
  if (input.passphrase?.trim()) {
    message += ` Passphrase (send separately): ${input.passphrase.trim()}`;
  }
  return message;
}

export function buildJoinCodeShareMessage(input: ShareMessageInput): string {
  const name = input.allianceName.trim() || "your alliance";
  const code = input.joinCode?.trim() ?? "";
  return `You're invited to join ${name} on Alliance HQ! Sign in at Alliance HQ, then redeem join code ${code} at /join to get started.`;
}

export function buildClaimCodeShareMessage(input: ShareMessageInput): string {
  const name = input.allianceName.trim() || "your alliance";
  const code = input.joinCode?.trim() ?? "";
  return `You're invited to claim your Commander on ${name} in Alliance HQ! Sign in, then redeem code ${code} at /join to link your account.`;
}
