export const ABSOLUTE_VR_CEILING = 12750;

export function gameSeasonIdForNumber(seasonNumber: number): string {
  return `season-${seasonNumber}`;
}

export function gameServerIdForNumber(serverNumber: number): string {
  return `server-${serverNumber}`;
}
