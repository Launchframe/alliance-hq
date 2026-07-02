/** Lowercase tag segment for alliance-scoped HQ routes (e.g. LFgo → lfgo). */
export function allianceTagPathSegment(tag: string): string {
  return tag.trim().toLowerCase();
}

export function allianceSettingsPath(tag: string): string {
  return `/alliance/${encodeURIComponent(allianceTagPathSegment(tag))}/settings`;
}

export function allianceSeasonApiPath(tag: string): string {
  return `/api/alliance/${encodeURIComponent(allianceTagPathSegment(tag))}/season`;
}

export function allianceTrainMinimumsApiPath(tag: string): string {
  return `/api/alliance/${encodeURIComponent(allianceTagPathSegment(tag))}/train-minimums`;
}

export function allianceTrainWeekApiPath(tag: string): string {
  return `/api/alliance/${encodeURIComponent(allianceTagPathSegment(tag))}/train-week`;
}

export function allianceTrainDiscordApiPath(tag: string): string {
  return `/api/alliance/${encodeURIComponent(allianceTagPathSegment(tag))}/train-discord`;
}

export function allianceVrSandboxApiPath(tag: string): string {
  return `/api/alliance/${encodeURIComponent(allianceTagPathSegment(tag))}/vr-sandbox`;
}
