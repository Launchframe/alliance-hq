const MAX_UA_LENGTH = 512;

export function truncateUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent?.trim()) {
    return null;
  }
  return userAgent.trim().slice(0, MAX_UA_LENGTH);
}

/** Best-effort OS label for display — not a full UA parser. */
export function parseOsLabelFromUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim() ?? "";
  if (!ua) {
    return "Unknown device";
  }

  const ios = ua.match(/\b(iPhone|iPad|iPod)\b.*\bOS (\d+[_.\d]*)/i);
  if (ios) {
    const device = ios[1] ?? "iOS device";
    const version = (ios[2] ?? "").replace(/_/g, ".");
    return version ? `${device} (iOS ${version})` : device;
  }

  const android = ua.match(/\bAndroid (\d+(?:\.\d+)?)/i);
  if (android) {
    return `Android ${android[1]}`;
  }

  if (/Windows NT/i.test(ua)) {
    return "Windows";
  }
  if (/Mac OS X/i.test(ua)) {
    return "macOS";
  }
  if (/CrOS/i.test(ua)) {
    return "ChromeOS";
  }
  if (/Linux/i.test(ua)) {
    return "Linux";
  }

  return "Unknown device";
}

export function defaultLinkedDeviceName(osLabel: string): string {
  return osLabel || "Mobile device";
}
