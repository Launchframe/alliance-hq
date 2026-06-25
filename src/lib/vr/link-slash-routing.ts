/** Route inline name+UID on `/link` to the commander link handler vs browser authorize. */
export function linkSlashUsesCommanderFlow(input: {
  name?: string;
  uid?: string;
}): boolean {
  return Boolean(input.name?.trim() || input.uid?.trim());
}
