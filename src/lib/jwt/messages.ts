export const ASHED_LOGOUT_WARNING =
  "Logging out of ashed.online could break your Alliance HQ connection, even if your token has not reached its expiration yet.";

export function tokenExpiryConnectedMessage(
  formattedDate: string,
  reminderDays: number,
): string {
  return `Your Ashed token is set to expire on ${formattedDate}. We'll remind you ${reminderDays} days before it's time to get a fresh token.`;
}

export function tokenExpiryReminderMessage(formattedDate: string): string {
  return `Your Ashed token expires on ${formattedDate}. Copy a fresh cURL command from ashed.online to stay connected.`;
}
