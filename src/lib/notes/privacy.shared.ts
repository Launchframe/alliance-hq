export function sensitiveNotesPath(path: string): boolean {
  try { return /(?:^|\/)(?:notes|shared\/notes)(?:\/|\?|$)/i.test(decodeURIComponent(path)); }
  catch { return true; }
}
export function privateTelemetryUrl(url: string): boolean {
  try { return sensitiveNotesPath(new URL(url, "http://localhost").pathname); }
  catch { return true; }
}
