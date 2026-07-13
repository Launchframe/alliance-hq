/** Stable reason codes for invite.accept_failed audit rows (no PII in metadata). */
export const INVITE_ACCEPT_REASON_CODES = [
  "auth_required",
  "invalid_body",
  "signed_in_email_required",
  "invite_not_found",
  "invite_expired",
  "email_required",
  "email_mismatch",
  "sign_in_email_mismatch",
  "passphrase_required",
  "passphrase_incorrect",
  "passphrase_consumed",
  "passphrase_missing",
  "discord_login_required",
  "discord_user_mismatch",
  "discord_target_missing",
  "alliance_tag_missing",
  "invite_belongs_to_other_account",
  "accept_failed",
] as const;

export type InviteAcceptReasonCode = (typeof INVITE_ACCEPT_REASON_CODES)[number];

const MESSAGE_TO_REASON: Readonly<Record<string, InviteAcceptReasonCode>> = {
  "Sign in required.": "auth_required",
  "Signed-in email is required.": "signed_in_email_required",
  "Invite not found or already used.": "invite_not_found",
  "Invite has expired.": "invite_expired",
  "Email is required.": "email_required",
  "Email does not match this invite.": "email_mismatch",
  "Sign in with the email address on this invite.": "sign_in_email_mismatch",
  "Invite passphrase is missing.": "passphrase_missing",
  "Passphrase already used.": "passphrase_consumed",
  "Passphrase is required.": "passphrase_required",
  "Incorrect passphrase.": "passphrase_incorrect",
  "Sign in with Discord to accept this invite.": "discord_login_required",
  "Discord account does not match this invite.": "discord_user_mismatch",
  "Invite Discord target is missing.": "discord_target_missing",
  "Alliance tag is missing.": "alliance_tag_missing",
  "This invite belongs to another account.": "invite_belongs_to_other_account",
};

export function inviteAcceptReasonFromMessage(
  message: string,
): InviteAcceptReasonCode {
  return MESSAGE_TO_REASON[message] ?? "accept_failed";
}

export function inviteAcceptReasonFromApiCode(
  code: string | undefined,
): InviteAcceptReasonCode {
  if (code === "auth_required") return "auth_required";
  if (code === "email_mismatch") return "email_mismatch";
  if (code === "discord_login_required") return "discord_login_required";
  if (code === "discord_user_mismatch") return "discord_user_mismatch";
  return "accept_failed";
}
